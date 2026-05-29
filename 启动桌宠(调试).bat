@echo off
chcp 65001 >nul
cd /d "%~dp0"
title NetPet Debug
echo === NetPet 调试模式 ===
echo 右键标题栏 → 属性 → 字体 → 选 Consolas 或 Lucida Console 可修复乱码
echo 中文日志请看 netpet-prompt.log
echo.
.\node_modules\electron\dist\electron.exe .
