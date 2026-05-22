@echo off
chcp 65001 >nul
cd /d D:\code\netpet
start "" ".\node_modules\electron\dist\electron.exe" .
exit
