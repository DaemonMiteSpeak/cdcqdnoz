#!/bin/bash
# Hider relay supervisor: keeps relay.js running forever (restart on crash / hang). Single instance via flock.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:/usr/local/bin:/usr/bin:/bin:$PATH
mkdir -p data
exec 9>data/supervisor.lock
flock -n 9 || exit 0
LOG=data/relay.log

health_loop() {
  local fails=0 port
  port=$(node -e "try{console.log(require('./data/config.json').controlPort||50001)}catch(e){console.log(50001)}")
  while true; do
    sleep 30
    if curl -sk -m 8 https://127.0.0.1:$port/api/health | grep -q '"ok":true'; then
      fails=0
    else
      fails=$((fails + 1))
      if [ "$fails" -ge 3 ]; then
        echo "$(date '+%F %T') health check failed 3x, killing relay" >> "$LOG"
        pkill -f "node relay.js" 2>/dev/null
        fails=0
      fi
    fi
  done
}
health_loop &
HL=$!
trap 'kill $HL 2>/dev/null' EXIT

while true; do
  if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 5000000 ]; then
    tail -c 1000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
  echo "$(date '+%F %T') starting relay" >> "$LOG"
  node relay.js >> "$LOG" 2>&1
  echo "$(date '+%F %T') relay exited rc=$?, restarting in 2s" >> "$LOG"
  sleep 2
done
