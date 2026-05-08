#!/usr/bin/env bash
# =============================================================================
# uninstall.sh — Remove the 802.1X Wi-Fi AAA Portal from Ubuntu 22.04
#
# Usage:
#   sudo bash uninstall.sh              # full wipe (prompts for confirmation)
#   sudo bash uninstall.sh --keep-data  # preserve MariaDB + .env (code-only wipe)
#   sudo bash uninstall.sh --force      # full wipe, no confirmation prompt
#   sudo bash uninstall.sh --keep-data --force
#
# --keep-data is useful before a reinstall when you want to preserve:
#   - The radius database (all RADIUS users, accounting, app_config)
#   - /opt/portal/.env  (DB password, JWT secret, AES key stay the same)
# =============================================================================
set -euo pipefail

PORTAL_DIR="/opt/portal"
KEEP_DATA=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --keep-data) KEEP_DATA=true ;;
    --force)     FORCE=true ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--keep-data] [--force]" >&2
      exit 1
      ;;
  esac
done

# ── Preflight ─────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Must be run as root." >&2
  exit 1
fi

# ── Confirmation ──────────────────────────────────────────────────────────────
if [[ "$FORCE" == false ]]; then
  echo "========================================================"
  echo "  Wi-Fi AAA Portal — UNINSTALL"
  echo "========================================================"
  if [[ "$KEEP_DATA" == true ]]; then
    echo "  Mode    : Code wipe only (--keep-data)"
    echo "  Keeping : MariaDB radius database, /opt/portal/.env"
    echo "  Removing: Services, code, Nginx config, systemd unit,"
    echo "            Python venv, FreeRADIUS configs, sudoers rule"
  else
    echo "  Mode    : FULL WIPE"
    echo "  Removing: Everything — database, secrets, code, configs"
    echo ""
    echo "  WARNING: All RADIUS users, sessions, accounting records,"
    echo "           and portal configuration will be PERMANENTLY DELETED."
  fi
  echo "========================================================"
  read -rp "  Type YES to continue: " confirm
  if [[ "$confirm" != "YES" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""
echo "==> Starting uninstall (keep-data=${KEEP_DATA})…"

# ── Stop & disable services ───────────────────────────────────────────────────
echo "==> Stopping services…"
for svc in portal-backend nginx freeradius; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    systemctl stop "$svc"
    echo "    Stopped $svc"
  fi
  if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
    systemctl disable "$svc"
    echo "    Disabled $svc"
  fi
done

# ── systemd unit ─────────────────────────────────────────────────────────────
echo "==> Removing systemd unit…"
rm -f /etc/systemd/system/portal-backend.service
systemctl daemon-reload

# ── Nginx config ──────────────────────────────────────────────────────────────
echo "==> Removing Nginx config…"
rm -f /etc/nginx/sites-enabled/portal.conf
rm -f /etc/nginx/sites-available/portal.conf
rm -f /etc/nginx/ssl/portal.crt
rm -f /etc/nginx/ssl/portal.key
# Restore the default site if nothing else is enabled
if [[ -z "$(ls /etc/nginx/sites-enabled/ 2>/dev/null)" ]]; then
  ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default 2>/dev/null || true
fi

# ── FreeRADIUS configs written by the portal ─────────────────────────────────
echo "==> Reverting FreeRADIUS configs…"

# Module configs written by the portal — always remove (file or symlink).
# The portal owns these paths entirely; FreeRADIUS starts without them.
# policy.d/concurrent_limit only exists after the wizard runs; that is fine.
for f in \
  /etc/freeradius/3.0/mods-enabled/ldap \
  /etc/freeradius/3.0/mods-enabled/sql \
  /etc/freeradius/3.0/policy.d/concurrent_limit
do
  if [[ -f "${f}.bak" ]]; then
    mv "${f}.bak" "$f"
    echo "    Restored ${f}.bak → $f"
  else
    rm -f "$f"   # rm -f handles files, symlinks, and absent paths safely
    echo "    Removed $f"
  fi
done

# clients.conf is required for FreeRADIUS to start — never leave it absent.
FR_CLIENTS="/etc/freeradius/3.0/clients.conf"
if [[ -f "${FR_CLIENTS}.bak" ]]; then
  mv "${FR_CLIENTS}.bak" "$FR_CLIENTS"
  echo "    Restored ${FR_CLIENTS}.bak → $FR_CLIENTS"
else
  # No backup means this was the first install; write a safe minimal default
  # so FreeRADIUS can start after a reinstall.
  cat > "$FR_CLIENTS" <<'CLIENTS'
# Restored by uninstall.sh — overwritten by the Wi-Fi AAA Portal setup wizard.
client localhost {
    ipaddr    = 127.0.0.1
    secret    = changeme_via_portal
    shortname = localhost
}
CLIENTS
  chown freerad:freerad "$FR_CLIENTS"
  chmod 640 "$FR_CLIENTS"
  echo "    Wrote minimal placeholder $FR_CLIENTS (no backup existed)"
fi

# ── Sudoers rule ──────────────────────────────────────────────────────────────
echo "==> Removing sudoers rule…"
rm -f /etc/sudoers.d/portal-freeradius

# ── Portal files ──────────────────────────────────────────────────────────────
if [[ "$KEEP_DATA" == true ]]; then
  echo "==> Removing code only (keeping .env)…"
  # Remove everything except .env and the easy-rsa PKI dir
  for d in backend frontend nginx venv easy-rsa; do
    rm -rf "${PORTAL_DIR:?}/${d}"
  done
  echo "    Kept: ${PORTAL_DIR}/.env"
else
  echo "==> Removing /opt/portal…"
  rm -rf "${PORTAL_DIR:?}"
fi

# ── MariaDB ───────────────────────────────────────────────────────────────────
if [[ "$KEEP_DATA" == true ]]; then
  echo "==> Keeping MariaDB radius database (--keep-data)"
else
  echo "==> Dropping MariaDB radius database and portaluser…"
  if systemctl is-active --quiet mariadb 2>/dev/null; then
    mariadb <<'SQL'
DROP DATABASE IF EXISTS radius;
DROP USER IF EXISTS 'portaluser'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    echo "    Dropped database 'radius' and user 'portaluser'@'127.0.0.1'"
  else
    echo "    WARNING: MariaDB not running — skipping DB drop" >&2
  fi
fi

# ── System user ───────────────────────────────────────────────────────────────
echo "==> Removing system user portaluser…"
if id -u portaluser &>/dev/null; then
  userdel portaluser
  echo "    Removed user portaluser"
fi

# ── UFW rules ─────────────────────────────────────────────────────────────────
echo "==> Resetting UFW rules…"
ufw --force reset
ufw --force enable
echo "    UFW reset to defaults (only SSH allowed)"

# ── Restart services that were left running ────────────────────────────────────
if [[ "$KEEP_DATA" == true ]]; then
  echo "==> Restarting MariaDB and FreeRADIUS…"
  systemctl restart mariadb 2>/dev/null || true
  # FreeRADIUS configs were removed so don't restart it blindly
fi

echo ""
echo "========================================================"
if [[ "$KEEP_DATA" == true ]]; then
  echo "  Uninstall complete (data preserved)."
  echo "  MariaDB radius DB and /opt/portal/.env are intact."
  echo "  Run install.sh to redeploy."
else
  echo "  Full uninstall complete."
  echo "  MariaDB, FreeRADIUS, and Nginx packages are still"
  echo "  installed — remove them manually with apt if needed:"
  echo ""
  echo "    apt-get purge freeradius freeradius-mysql \\"
  echo "      freeradius-ldap mariadb-server nginx nodejs"
fi
echo "========================================================"
