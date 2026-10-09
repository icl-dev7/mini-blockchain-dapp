@echo off
chcp 65001 >nul
title Mini Blockchain DApp
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, so na primeira vez...
  call npm install || (pause & exit /b 1)
)

call npm start
pause
