@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
:loop
node --env-file-if-exists=.env src/index.js
echo البوت وقف، برجع أشغله بعد 5 ثواني...
timeout /t 5 >nul
goto loop
