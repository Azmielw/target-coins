#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
while true; do
  node --env-file-if-exists=.env src/index.js
  echo "البوت وقف، برجع أشغله بعد 5 ثواني..."
  sleep 5
done
