#!/usr/bin/env bash
# =============================================================================
# reinstall.sh — Uninstall then reinstall the 802.1X Wi-Fi AAA Portal
#
# Usage:
#   sudo bash reinstall.sh [PORTAL_VLAN_IP] [AC_IP]          # full reinstall
#   sudo bash reinstall.sh --keep-data [VLAN_IP] [AC_IP]     # code-only reinstall
#
# --keep-data  Preserves the MariaDB radius database and /opt/portal/.env.
#              The setup wizard will NOT be shown again — the portal comes
#              back up with its existing configuration and all data intact.
#              Use this when deploying code changes only.
#
# Full reinstall (no flag) drops the database and .env, then runs a clean
# install. The setup wizard will be shown after reinstall completes.
#
# Examples:
#   sudo bash reinstall.sh 192.168.12.216 192.168.100.248
#   sudo bash reinstall.sh --keep-data 192.168.12.216 192.168.100.248
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEEP_DATA=false
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --keep-data) KEEP_DATA=true ;;
    --*)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 [--keep-data] [PORTAL_VLAN_IP] [AC_IP]" >&2
      exit 1
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

PORTAL_VLAN_IP="${POSITIONAL[0]:-$(hostname -I | awk '{print $1}')}"
AC_IP="${POSITIONAL[1]:-}"

# ── Preflight ─────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Must be run as root." >&2
  exit 1
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo "========================================================"
echo "  Wi-Fi AAA Portal — REINSTALL"
echo "========================================================"
echo "  VLAN IP   : ${PORTAL_VLAN_IP}"
echo "  AC IP     : ${AC_IP:-"(not specified)"}"
if [[ "$KEEP_DATA" == true ]]; then
  echo "  Mode      : Code update (--keep-data)"
  echo "  Database  : PRESERVED"
  echo "  .env      : PRESERVED (same secrets, no re-setup wizard)"
else
  echo "  Mode      : Full reinstall"
  echo "  Database  : WIPED and recreated"
  echo "  .env      : REGENERATED (new secrets, setup wizard required)"
fi
echo "========================================================"
read -rp "  Type YES to continue: " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# ── Step 1: Uninstall ─────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 1/2 — Uninstall"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

UNINSTALL_ARGS="--force"
if [[ "$KEEP_DATA" == true ]]; then
  UNINSTALL_ARGS="--keep-data --force"
fi

# shellcheck disable=SC2086
bash "${SCRIPT_DIR}/uninstall.sh" $UNINSTALL_ARGS

echo ""

# ── Step 2: Install ───────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 2/2 — Install"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

bash "${SCRIPT_DIR}/install.sh" "${PORTAL_VLAN_IP}" "${AC_IP}"

echo ""
echo "========================================================"
echo "  Reinstall complete."
if [[ "$KEEP_DATA" == true ]]; then
  echo "  Your data and configuration are intact."
  echo "  The portal is running with the existing setup."
else
  echo "  Visit https://${PORTAL_VLAN_IP}/setup to reconfigure."
fi
echo "========================================================"
