#!/bin/bash
cd /home/z/my-project

# Check if port 3000 is in use
if ss -tlnp 2>/dev/null | grep -q ':3000'; then
  exit 0  # already running
fi

# Kill zombies + start fresh
pkill -9 -f "next" 2>/dev/null
sleep 1

# Start fully detached
setsid bash -c 'cd /home/z/my-project && exec /home/z/my-project/node_modules/.bin/next dev -p 3000' </dev/null >>/home/z/my-project/dev.log 2>&1 &
disown -a

echo "[$(date)] Cron restarted server" >> /home/z/my-project/dev-keepalive.log
