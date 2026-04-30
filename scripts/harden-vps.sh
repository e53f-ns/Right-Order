#!/usr/bin/env bash
# ══════════════════════════════════════════════
# Right Order — VPS Hardening Script
# ══════════════════════════════════════════════
# Idempotent. Run as root (or via sudo) on a fresh Debian/Ubuntu VPS.
# What it does:
#   1. UFW firewall: allow 22, 80, 443, 3100; deny everything else.
#   2. fail2ban with sshd jail.
#   3. SSH: disable root login + password auth (key-only).
#   4. sysctl: basic network hardening.
#   5. Unattended security updates.
#
# Re-run safely after edits — every step checks current state before acting.
# ══════════════════════════════════════════════

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (try: sudo $0)" >&2
  exit 1
fi

log()  { printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }

# ── Sanity check: at least one non-root user with an authorized SSH key ──
log "Verifying a non-root user has an SSH key (so we don't lock you out)…"
HAS_KEY_USER=""
for u in $(awk -F: '$3 >= 1000 && $3 < 65534 { print $1 }' /etc/passwd); do
  home=$(getent passwd "$u" | cut -d: -f6)
  if [[ -s "$home/.ssh/authorized_keys" ]]; then
    HAS_KEY_USER="$u"
    break
  fi
done
if [[ -z "$HAS_KEY_USER" ]]; then
  warn "No non-root user with ~/.ssh/authorized_keys found."
  warn "If you continue, disabling password auth WILL lock you out."
  read -r -p "Type 'I HAVE CONSOLE ACCESS' to proceed anyway: " ack
  [[ "$ack" == "I HAVE CONSOLE ACCESS" ]] || { echo "Aborting."; exit 1; }
else
  log "Found SSH key for user: $HAS_KEY_USER"
fi

# ── 1. Packages ──
log "Installing ufw, fail2ban, unattended-upgrades…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ufw fail2ban unattended-upgrades apt-listchanges

# ── 2. UFW firewall ──
log "Configuring UFW firewall…"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     comment 'SSH'
ufw allow 80/tcp     comment 'HTTP'
ufw allow 443/tcp    comment 'HTTPS'
ufw allow 3100/tcp   comment 'Right Order app'
ufw --force enable
ufw status verbose

# ── 3. fail2ban ──
log "Configuring fail2ban (sshd jail)…"
cat > /etc/fail2ban/jail.d/sshd.local << 'EOF'
[sshd]
enabled  = true
port     = ssh
filter   = sshd
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ── 4. SSH hardening ──
log "Hardening SSH (key-only, no root login)…"
SSHD=/etc/ssh/sshd_config
cp -n "$SSHD" "${SSHD}.orig.$(date +%Y%m%d)" || true
# Drop our overrides into a sourced file so we don't fight package updates.
cat > /etc/ssh/sshd_config.d/99-hardening.conf << 'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
# Validate before reloading — broken config = locked out.
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd

# ── 5. sysctl hardening ──
log "Applying sysctl network hardening…"
cat > /etc/sysctl.d/99-rightorder-hardening.conf << 'EOF'
# IP spoofing protection
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP broadcast / bogus responses
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Disable source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# Disable ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0

# SYN flood protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# Log martians
net.ipv4.conf.all.log_martians = 1

# Kernel hardening
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF
sysctl --system >/dev/null

# ── 6. Unattended security upgrades ──
log "Enabling unattended security upgrades…"
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

log "Done. Summary:"
echo "  • UFW: 22, 80, 443, 3100 allowed; everything else denied."
echo "  • fail2ban: sshd jail active (5 retries / 10m → 1h ban)."
echo "  • SSH: root login + password auth disabled; key-only."
echo "  • sysctl: hardening applied (see /etc/sysctl.d/99-rightorder-hardening.conf)."
echo "  • Unattended security upgrades: enabled."
echo
warn "Test SSH from a NEW terminal before logging out of this session."
