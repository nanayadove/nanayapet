@echo off
cd /d "%~dp0"
echo ========================================
echo  NetPet - Installing dependencies...
echo  This window will close automatically, do not close it manually.
echo ========================================
echo.
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npm install
echo.
echo ========================================
echo  Done! Press any key to close.
echo ========================================
pause >nul
exit
