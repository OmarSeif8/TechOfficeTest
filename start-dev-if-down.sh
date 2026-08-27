#!/bin/bash
# Check if port 3000 is in use
if ss -tlnp | grep -q ':3000'; then
  echo "Dev server already running"
  exit 0
fi
# Start dev server
cd /home/z/my-project
nohup /home/z/my-project/node_modules/.bin/next dev -p 3000 </dev/null > /home/z/my-project/dev.log 2>&1 &
disown
echo "Dev server started by cron"
