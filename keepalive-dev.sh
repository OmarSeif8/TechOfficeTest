#!/bin/bash
# Keepalive script — checks if dev server is running, starts it if not.
# Designed to be called by cron every minute.

cd /home/z/my-project

# Check if port 3000 is in use
if ss -tlnp 2>/dev/null | grep -q ':3000'; then
  # Server is already running — do nothing
  exit 0
fi

# Server is down — kill any zombie processes
pkill -9 -f "next" 2>/dev/null
sleep 1

# Start the server fully detached
setsid bash -c 'cd /home/z/my-project && exec /home/z/my-project/node_modules/.bin/next dev -p 3000' </dev/null >>/home/z/my-project/dev.log 2>&1 &
disown -a

# Log the restart
echo "[$(date)] Server restarted by keepalive" >> /home/z/my-project/dev-keepalive.log
