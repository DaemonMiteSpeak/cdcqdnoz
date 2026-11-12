#!/bin/bash
# Installs/updates the Hider relay as its own systemd service. Does not touch other services.
set -e
D=/opt/hider-relay
mkdir -p $D/data/logs
cd $D
if [ ! -d node_modules/ws ]; then npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1; fi
if [ ! -f data/tls.key ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout data/tls.key -out data/tls.crt -days 3650 -subj "/CN=hider-relay" -addext "subjectAltName=IP:51.77.71.48" 2>/dev/null
  chmod 600 data/tls.key
fi
cat > /etc/systemd/system/hider-relay.service <<'EOF'
[Unit]
Description=Hider relay (Minecraft tunnel + logs)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/hider-relay
ExecStart=/usr/local/bin/node /opt/hider-relay/relay.js
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
ufw allow 8871/tcp >/dev/null
ufw allow 25600:25699/tcp >/dev/null
systemctl enable hider-relay >/dev/null 2>&1
systemctl restart hider-relay
sleep 1
systemctl is-active hider-relay
openssl x509 -in data/tls.crt -noout -fingerprint -sha256
