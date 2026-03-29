#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# NexCP v5 Installer / Upgrader
# ══════════════════════════════════════════════════════════════════════════════
#
# Fresh install:   sudo bash install.sh
# Upgrade from v4: sudo bash install.sh   (auto-detects existing install)
#
# Installs to: /opt/nexcp
# Preserves:   database (data/nexcp.db), .env, backups/
# ══════════════════════════════════════════════════════════════════════════════

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; C='\033[0;36m'; B='\033[1m'; NC='\033[0m'
ok()   { echo -e "${G}[✓]${NC} $1"; }
info() { echo -e "${C}[→]${NC} $1"; }
warn() { echo -e "${Y}[!]${NC} $1"; }
fail() { echo -e "${R}[✗]${NC} $1"; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "Run as root: sudo bash install.sh"

INSTALL_DIR="/opt/nexcp"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_TS=$(date +%Y%m%d_%H%M%S)
IS_UPGRADE=false

echo ""
echo -e "${B}══════════════════════════════════════════${NC}"
echo -e "${B}  NexCP v5 — Install / Upgrade${NC}"
echo -e "${B}══════════════════════════════════════════${NC}"
echo ""

# ── Detect existing install ───────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/backend/server.js" ]; then
  IS_UPGRADE=true
  info "Existing NexCP found at $INSTALL_DIR — running UPGRADE"
  echo ""

  # ── Backup existing install ───────────────────────────────────────────────
  BACKUP_DIR="/opt/nexcp-backup-${BACKUP_TS}"
  info "Backing up current install to $BACKUP_DIR"
  cp -a "$INSTALL_DIR" "$BACKUP_DIR"
  ok "Backup created: $BACKUP_DIR"

  # ── Preserve user data ────────────────────────────────────────────────────
  # Save .env if it exists
  if [ -f "$INSTALL_DIR/backend/.env" ]; then
    cp "$INSTALL_DIR/backend/.env" "/tmp/nexcp_env_${BACKUP_TS}"
    ok "Saved .env"
  fi

  # Save database (check both possible locations)
  if [ -f "$INSTALL_DIR/backend/data/nexcp.db" ]; then
    mkdir -p "/tmp/nexcp_data_${BACKUP_TS}"
    cp "$INSTALL_DIR/backend/data/nexcp.db"* "/tmp/nexcp_data_${BACKUP_TS}/" 2>/dev/null || true
    ok "Saved database"
  elif [ -f "$INSTALL_DIR/data/nexcp.db" ]; then
    mkdir -p "/tmp/nexcp_data_${BACKUP_TS}"
    cp "$INSTALL_DIR/data/nexcp.db"* "/tmp/nexcp_data_${BACKUP_TS}/" 2>/dev/null || true
    ok "Saved database (legacy path)"
  fi

  # Save backups folder
  if [ -d "$INSTALL_DIR/backend/backups" ] && [ "$(ls -A "$INSTALL_DIR/backend/backups" 2>/dev/null)" ]; then
    cp -a "$INSTALL_DIR/backend/backups" "/tmp/nexcp_backups_${BACKUP_TS}"
    ok "Saved backups folder"
  elif [ -d "$INSTALL_DIR/backups" ] && [ "$(ls -A "$INSTALL_DIR/backups" 2>/dev/null)" ]; then
    cp -a "$INSTALL_DIR/backups" "/tmp/nexcp_backups_${BACKUP_TS}"
    ok "Saved backups folder (legacy path)"
  fi

  # ── Stop PM2 process ─────────────────────────────────────────────────────
  if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "nexcp"; then
    info "Stopping PM2 nexcp process..."
    pm2 stop nexcp 2>/dev/null || true
    ok "PM2 stopped"
  fi

  # ── Remove old files and folders ─────────────────────────────────────────
  info "Removing old NexCP files from $INSTALL_DIR..."

  # Remove old backend code (NOT data or .env)
  rm -f "$INSTALL_DIR/backend/server.js"
  rm -f "$INSTALL_DIR/backend/device-flow.js"
  rm -f "$INSTALL_DIR/backend/database.js"
  rm -f "$INSTALL_DIR/backend/package.json"
  rm -f "$INSTALL_DIR/backend/package-lock.json"

  # Remove old frontend completely (we're replacing it)
  rm -rf "$INSTALL_DIR/frontend-panel"
  rm -rf "$INSTALL_DIR/frontend-link"

  # Remove old nginx config
  rm -rf "$INSTALL_DIR/nginx"

  # Remove any stale top-level files from older versions
  rm -f "$INSTALL_DIR/mail.html"
  rm -f "$INSTALL_DIR/patch.sh"
  rm -f "$INSTALL_DIR/install.sh"

  # Remove old node_modules (will reinstall fresh)
  rm -rf "$INSTALL_DIR/backend/node_modules"

  ok "Old files removed"

else
  info "Fresh install to $INSTALL_DIR"
  echo ""
fi

# ── Create directory structure ────────────────────────────────────────────────
info "Creating directory structure..."
mkdir -p "$INSTALL_DIR/backend/data"
mkdir -p "$INSTALL_DIR/backend/backups"
mkdir -p "$INSTALL_DIR/frontend-panel/js"
mkdir -p "$INSTALL_DIR/frontend-link"
mkdir -p "$INSTALL_DIR/nginx"
ok "Directories created"

# ── Copy new files ────────────────────────────────────────────────────────────
info "Copying NexCP v5 files to $INSTALL_DIR..."

# Backend
cp "$SRC_DIR/backend/server.js"      "$INSTALL_DIR/backend/server.js"
cp "$SRC_DIR/backend/device-flow.js" "$INSTALL_DIR/backend/device-flow.js"
cp "$SRC_DIR/backend/database.js"    "$INSTALL_DIR/backend/database.js"
cp "$SRC_DIR/backend/package.json"   "$INSTALL_DIR/backend/package.json"
ok "Backend (4 files)"

# Frontend panel + modular JS
cp "$SRC_DIR/frontend-panel/index.html" "$INSTALL_DIR/frontend-panel/index.html"
cp "$SRC_DIR/frontend-panel/mail.html"  "$INSTALL_DIR/frontend-panel/mail.html"
cp "$SRC_DIR/frontend-panel/js/"*.js    "$INSTALL_DIR/frontend-panel/js/"
JS_COUNT=$(ls "$INSTALL_DIR/frontend-panel/js/"*.js 2>/dev/null | wc -l)
ok "Frontend panel + $JS_COUNT JS modules"

# Link page
cp "$SRC_DIR/frontend-link/index.html" "$INSTALL_DIR/frontend-link/index.html"
ok "Link page"

# Nginx
cp "$SRC_DIR/nginx/nexcp.conf" "$INSTALL_DIR/nginx/nexcp.conf"
ok "Nginx config template"

# Copy install script itself for future use
cp "$SRC_DIR/install.sh" "$INSTALL_DIR/install.sh"
chmod +x "$INSTALL_DIR/install.sh"

# ── Restore preserved data ────────────────────────────────────────────────────
if [ "$IS_UPGRADE" = true ]; then
  info "Restoring your data..."

  # Restore .env
  if [ -f "/tmp/nexcp_env_${BACKUP_TS}" ]; then
    cp "/tmp/nexcp_env_${BACKUP_TS}" "$INSTALL_DIR/backend/.env"
    rm -f "/tmp/nexcp_env_${BACKUP_TS}"
    ok "Restored .env (your settings preserved)"
  fi

  # Restore database
  if [ -d "/tmp/nexcp_data_${BACKUP_TS}" ]; then
    cp "/tmp/nexcp_data_${BACKUP_TS}/"* "$INSTALL_DIR/backend/data/" 2>/dev/null || true
    rm -rf "/tmp/nexcp_data_${BACKUP_TS}"
    ok "Restored database (users, tokens, sessions preserved)"
  fi

  # Restore backups
  if [ -d "/tmp/nexcp_backups_${BACKUP_TS}" ]; then
    cp -a "/tmp/nexcp_backups_${BACKUP_TS}/"* "$INSTALL_DIR/backend/backups/" 2>/dev/null || true
    rm -rf "/tmp/nexcp_backups_${BACKUP_TS}"
    ok "Restored backups"
  fi

else
  # Fresh install — copy default .env
  if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
    cp "$SRC_DIR/backend/.env" "$INSTALL_DIR/backend/.env"
    warn "Default .env created — EDIT BEFORE GOING LIVE!"
  fi
fi

# ── Install Node.js if missing ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Node.js not found — installing..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
else
  ok "Node.js $(node -v) found"
fi

# ── Install PM2 if missing ───────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2
  ok "PM2 installed"
else
  ok "PM2 found"
fi

# ── Install NPM dependencies ─────────────────────────────────────────────────
info "Installing Node dependencies..."
cd "$INSTALL_DIR/backend"
npm install --production 2>&1 | tail -3
ok "Dependencies installed"

# ── Set permissions ───────────────────────────────────────────────────────────
chown -R root:root "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/backend/.env"
chmod 600 "$INSTALL_DIR/backend/data/nexcp.db" 2>/dev/null || true

# ── Start / Restart PM2 ──────────────────────────────────────────────────────
info "Starting NexCP..."
cd "$INSTALL_DIR/backend"

if pm2 list 2>/dev/null | grep -q "nexcp"; then
  pm2 restart nexcp
  ok "PM2 restarted"
else
  pm2 start server.js --name nexcp --cwd "$INSTALL_DIR/backend"
  pm2 save 2>/dev/null || true
  pm2 startup 2>/dev/null || true
  ok "PM2 started fresh"
fi

sleep 3

# ── Verify ────────────────────────────────────────────────────────────────────
if pm2 list | grep -q "nexcp.*online"; then
  ok "PM2 nexcp is ONLINE"
else
  warn "PM2 process may have issues:"
  pm2 logs nexcp --lines 10 --nostream
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  ok "Health check: HTTP $HTTP_CODE"
else
  warn "Health check: HTTP $HTTP_CODE — may still be starting"
fi

# ── Nginx hint ────────────────────────────────────────────────────────────────
if command -v nginx &>/dev/null && [ ! -f "/etc/nginx/sites-enabled/nexcp" ]; then
  echo ""
  info "Nginx detected but no nexcp vhost. To set up:"
  echo "    cp $INSTALL_DIR/nginx/nexcp.conf /etc/nginx/sites-available/nexcp"
  echo "    ln -s /etc/nginx/sites-available/nexcp /etc/nginx/sites-enabled/"
  echo "    nano /etc/nginx/sites-available/nexcp   # set server_name"
  echo "    nginx -t && systemctl reload nginx"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}══════════════════════════════════════════════════${NC}"
if [ "$IS_UPGRADE" = true ]; then
  echo -e "${G}  NexCP v5 UPGRADE COMPLETE${NC}"
  echo -e "${G}══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Old install backed up to: $BACKUP_DIR"
  echo "  Database, .env, and tokens are preserved."
else
  echo -e "${G}  NexCP v5 FRESH INSTALL COMPLETE${NC}"
  echo -e "${G}══════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${Y}!! Edit before going live:${NC}"
  echo "     nano $INSTALL_DIR/backend/.env"
  echo "     → Change JWT_SECRET"
  echo "     → Change ADMIN_PASSWORD"
fi
echo ""
echo "  Install dir:    $INSTALL_DIR"
echo "  Panel:          http://YOUR_IP:3000"
echo "  Mail:           http://YOUR_IP:3000/mail"
echo "  Link device:    http://YOUR_IP:3000/link"
echo ""
echo "  Commands:"
echo "    pm2 logs nexcp        — view logs"
echo "    pm2 restart nexcp     — restart"
echo "    pm2 stop nexcp        — stop"
echo ""
echo "  Modular JS files (edit by section):"
echo "    $INSTALL_DIR/frontend-panel/js/"
echo "      api.js      — HTTP calls      inbox.js   — message list"
echo "      ui.js       — helpers/toast    reader.js  — email viewer"
echo "      folders.js  — folder sidebar   compose.js — compose/reply"
echo "      actions.js  — move dialog      rules.js   — inbox rules"
echo "      init.js     — startup/auth"
echo ""
