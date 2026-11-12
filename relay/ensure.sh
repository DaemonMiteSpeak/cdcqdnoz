#!/bin/bash
# Cron entry point: starts the supervisor if (and only if) it is not already running.
D="$(dirname "$(readlink -f "$0")")"
cd "$D" || exit 1
mkdir -p data
if flock -n data/supervisor.lock true 2>/dev/null; then
  setsid nohup "$D/start.sh" >/dev/null 2>&1 < /dev/null &
fi
exit 0
