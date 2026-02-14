@echo off
REM Uruchamia pr.ps1 w tle, bez konsoli i bez blokowania BAT
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ^
"Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%~dp0pr.ps1""' -WindowStyle Hidden -WorkingDirectory '%~dp0'"
exit
