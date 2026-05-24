@echo off
REM ===== 启动桌宠.bat — 一键启动脚本 =====
REM @echo off   — 关闭命令回显（不显示每条命令本身）
REM chcp 65001  — 设置控制台编码为 UTF-8（防止中文乱码）
REM cd /d       — 切换目录，/d 支持跨盘符切换
REM start ""    — 启动程序，"" 是窗口标题（空字符串）
REM electron.exe . — 运行当前目录下的 Electron 应用
REM exit        — 退出命令窗口

chcp 65001 >nul
cd /d "%~dp0"
start "" ".\node_modules\electron\dist\electron.exe" .
exit
