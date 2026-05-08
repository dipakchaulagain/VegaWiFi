#!/usr/bin/env bash
# =============================================================================
# install.sh — Full automated installer for the 802.1X Wi-Fi AAA Portal
# Target: Ubuntu 22.04 LTS (single-VM)
# Usage:  sudo bash install.sh [PORTAL_VLAN_IP] [AC_IP]
# =============================================================================
set -euo pipefail

# ── Argument / env defaults ───────────────────────────────────────────────────
PORTAL_VLAN_IP="${1:-$(hostname -I | awk '{print $1}')}"
AC_IP="${2:-}"  # optional: lock RADIUS ports to this IP only
PORTAL_DIR="/opt/portal"

# Resolve the directory that contains this script (works whether the script
# is run as "sudo bash install.sh" or "sudo ./install.sh" from any CWD).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Preflight checks ─────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Must be run as root." >&2
  exit 1
fi

OS_ID=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
OS_VER=$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
if [[ "$OS_ID" != "ubuntu" || "$OS_VER" != "22.04" ]]; then
  echo "ERROR: Requires Ubuntu 22.04 (detected: $OS_ID $OS_VER)" >&2
  exit 1
fi

echo "==> Detected: Ubuntu 22.04 — VLAN IP: $PORTAL_VLAN_IP"

# ── Package installation ──────────────────────────────────────────────────────
echo "==> Installing packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y \
  freeradius freeradius-mysql freeradius-ldap freeradius-utils \
  mariadb-server nginx \
  python3 python3-pip python3-venv \
  ufw easy-rsa \
  openssl curl ca-certificates gnupg

# ── Node.js 20 LTS via NodeSource (Ubuntu ships Node 12 which is too old) ────
echo "==> Installing Node.js 20 LTS…"
NODE_MAJOR=20
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}"; then
  # Purge ALL Ubuntu-packaged Node artifacts that conflict with NodeSource.
  # libnode-dev and libnode72 own files that nodejs_20 also wants to install,
  # causing a dpkg "trying to overwrite" error if left in place.
  apt-get purge -y \
    nodejs nodejs-doc npm \
    libnode-dev libnode72 \
    node-gyp node-tap node-tap-mocha-reporter node-tap-parser \
    node-coveralls node-cacache node-copy-concurrently \
    node-move-concurrently 2>/dev/null || true
  apt-get autoremove -y 2>/dev/null || true

  mkdir -p /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y nodejs
fi
echo "  Node $(node --version)  npm $(npm --version)"

# ── Copy project files to /opt/portal ────────────────────────────────────────
echo "==> Copying project files to ${PORTAL_DIR}…"
mkdir -p "$PORTAL_DIR"

# rsync is not always present on minimal Ubuntu; use cp -a with explicit dirs.
# Preserve existing .env if the installer is being re-run.
for d in backend frontend nginx; do
  rm -rf "${PORTAL_DIR:?}/${d}"
  cp -a "${SCRIPT_DIR}/${d}" "${PORTAL_DIR}/${d}"
done
cp -a "${SCRIPT_DIR}/install.sh" "${PORTAL_DIR}/install.sh"

# ── Generate secrets ──────────────────────────────────────────────────────────
echo "==> Generating secrets…"
DB_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)
JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)
AES_KEY=$(openssl rand -hex 32)

# ── Write .env ────────────────────────────────────────────────────────────────
mkdir -p "$PORTAL_DIR"
cat > "$PORTAL_DIR/.env" <<EOF
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=radius
DB_USER=portaluser
DB_PASS=${DB_PASS}
JWT_SECRET=${JWT_SECRET}
AES_KEY=${AES_KEY}
FR_CONFIG_DIR=/etc/freeradius/3.0
FR_LOG=/var/log/freeradius/radius.log
PORTAL_VLAN_IP=${PORTAL_VLAN_IP}
EOF
chmod 600 "$PORTAL_DIR/.env"

# ── MariaDB setup ─────────────────────────────────────────────────────────────
echo "==> Configuring MariaDB…"
systemctl enable --now mariadb

mariadb <<SQL
CREATE DATABASE IF NOT EXISTS radius CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'portaluser'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON radius.* TO 'portaluser'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# Import FreeRADIUS schema
FR_SCHEMA="/etc/freeradius/3.0/mods-config/sql/main/mysql/schema.sql"
if [[ -f "$FR_SCHEMA" ]]; then
  echo "==> Importing FreeRADIUS schema…"
  mariadb radius < "$FR_SCHEMA"
else
  echo "WARNING: FreeRADIUS schema not found at $FR_SCHEMA" >&2
fi

# Create portal-owned tables
echo "==> Creating portal tables…"
mariadb radius <<'SQL'
CREATE TABLE IF NOT EXISTS app_config (
  `key`      VARCHAR(64) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  admin_user  VARCHAR(128),
  action      VARCHAR(64),
  target      VARCHAR(128),
  detail      JSON,
  ip_address  VARCHAR(45),
  INDEX idx_ts (ts),
  INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS portal_users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  role          ENUM('admin','viewer') DEFAULT 'admin',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO app_config (`key`, value) VALUES ('setup_complete', '0');
SQL

# ── System user ───────────────────────────────────────────────────────────────
echo "==> Creating system user portaluser…"
id -u portaluser &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin portaluser

# ── Python virtual environment ────────────────────────────────────────────────
echo "==> Setting up Python venv…"
python3 -m venv "$PORTAL_DIR/venv"
"$PORTAL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$PORTAL_DIR/venv/bin/pip" install --quiet -r "$PORTAL_DIR/backend/requirements.txt"

# ── File ownership ────────────────────────────────────────────────────────────
echo "==> Setting file ownership…"
chown -R portaluser:freerad "$PORTAL_DIR/backend" 2>/dev/null || true
chown -R portaluser:freerad /etc/freeradius/3.0/mods-enabled 2>/dev/null || true
chown -R portaluser:freerad /etc/freeradius/3.0/policy.d 2>/dev/null || true
chown portaluser:freerad /etc/freeradius/3.0/clients.conf 2>/dev/null || true
chmod 640 "$PORTAL_DIR/.env"
chown portaluser:portaluser "$PORTAL_DIR/.env"

# ── Sudoers rule ──────────────────────────────────────────────────────────────
echo "==> Writing sudoers rule…"
cat > /etc/sudoers.d/portal-freeradius <<'EOF'
portaluser ALL=(ALL) NOPASSWD: /bin/systemctl reload freeradius
EOF
chmod 440 /etc/sudoers.d/portal-freeradius

# ── Enable FreeRADIUS SQL module ──────────────────────────────────────────────
echo "==> Enabling FreeRADIUS modules…"
ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql 2>/dev/null || true
ln -sf /etc/freeradius/3.0/mods-available/ldap /etc/freeradius/3.0/mods-enabled/ldap 2>/dev/null || true

# ── Ensure clients.conf exists so FreeRADIUS can start ───────────────────────
# The portal setup wizard will overwrite this with real NAS entries.
# Without this file FreeRADIUS refuses to start entirely.
FR_CLIENTS="/etc/freeradius/3.0/clients.conf"
if [[ ! -f "$FR_CLIENTS" ]]; then
  echo "==> Writing placeholder clients.conf (wizard will replace this)…"
  cat > "$FR_CLIENTS" <<'CLIENTS'
# Placeholder — overwritten by the Wi-Fi AAA Portal setup wizard.
client localhost {
    ipaddr    = 127.0.0.1
    secret    = changeme_via_portal
    shortname = localhost
}
CLIENTS
  chown freerad:freerad "$FR_CLIENTS"
  chmod 640 "$FR_CLIENTS"
fi

# ── Build frontend ────────────────────────────────────────────────────────────
echo "==> Building React frontend…"
cd "$PORTAL_DIR/frontend"
if [[ -f package-lock.json ]]; then
  npm ci
else
  echo "  WARNING: no package-lock.json found, running npm install instead" >&2
  npm install
fi
npm run build
cd "$PORTAL_DIR"

# ── Nginx TLS (self-signed) ───────────────────────────────────────────────────
echo "==> Generating self-signed TLS certificate for Nginx…"
mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/portal.key \
  -out /etc/nginx/ssl/portal.crt \
  -subj "/CN=${PORTAL_VLAN_IP}/O=Wi-Fi AAA Portal"

# ── Nginx config ──────────────────────────────────────────────────────────────
echo "==> Installing Nginx config…"
cp "$PORTAL_DIR/nginx/portal.conf" /etc/nginx/sites-available/portal.conf
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
ln -sf /etc/nginx/sites-available/portal.conf /etc/nginx/sites-enabled/portal.conf
nginx -t

# ── systemd unit ─────────────────────────────────────────────────────────────
echo "==> Creating systemd unit…"
cat > /etc/systemd/system/portal-backend.service <<EOF
[Unit]
Description=Wi-Fi AAA Portal Backend
After=network.target mariadb.service

[Service]
Type=simple
User=portaluser
Group=portaluser
WorkingDirectory=${PORTAL_DIR}
EnvironmentFile=${PORTAL_DIR}/.env
ExecStart=${PORTAL_DIR}/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=portal-backend

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# ── Firewall (ufw) ────────────────────────────────────────────────────────────
echo "==> Configuring firewall…"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow to "${PORTAL_VLAN_IP}" port 443 proto tcp

if [[ -n "$AC_IP" ]]; then
  ufw allow from "${AC_IP}" to any port 1812 proto udp
  ufw allow from "${AC_IP}" to any port 1813 proto udp
  ufw allow from "${AC_IP}" to any port 3799 proto udp
else
  echo "WARNING: No AC_IP specified — RADIUS ports open to all. Pass AC_IP as second argument to restrict." >&2
  ufw allow 1812/udp
  ufw allow 1813/udp
  ufw allow 3799/udp
fi

ufw --force enable

# ── Enable & start services ───────────────────────────────────────────────────
echo "==> Starting services…"
systemctl enable --now mariadb
systemctl enable --now freeradius
systemctl enable --now portal-backend
systemctl enable --now nginx

# Brief wait for backend
sleep 3

# ── Health check ─────────────────────────────────────────────────────────────
if curl -sk "https://${PORTAL_VLAN_IP}/api/v1/setup/status" | grep -q '"setup_complete"'; then
  echo ""
  echo "============================================================"
  echo "  Setup complete!"
  echo "  Visit: https://${PORTAL_VLAN_IP}/setup"
  echo "  to complete the first-run configuration wizard."
  echo "============================================================"
else
  echo ""
  echo "WARNING: Health check failed — check 'journalctl -u portal-backend'" >&2
fi
