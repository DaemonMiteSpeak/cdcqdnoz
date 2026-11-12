#!/bin/bash
# Runs bot/tools/app-e2e.mjs against a throwaway DEV server with a fake release file.
set -e
cd "$(dirname "$0")/.."
export DB_FILE=/tmp/app-e2e.db DEV=1 PORT=3115 INTERNAL_PORT=3116 RELAY_SECRET=testsecret APP_EXE=/tmp/fake-release.exe WEBAPP_URL=http://localhost:3115 AVATAR_DIR=/tmp/app-e2e-avatars
rm -f /tmp/app-e2e.db* && rm -rf $AVATAR_DIR
head -c 3000000 /dev/urandom > /tmp/fake-release.exe
printf 'HDRSFX01' >> /tmp/fake-release.exe
head -c 56 /dev/zero >> /tmp/fake-release.exe
node --disable-warning=ExperimentalWarning src/index.js > /tmp/app-e2e.server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3115/ && break; sleep 0.25; done
node --disable-warning=ExperimentalWarning tools/app-e2e.mjs
