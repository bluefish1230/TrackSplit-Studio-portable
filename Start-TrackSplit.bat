@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=%~dp0bin\node.exe"
set "FFMPEG_PATH=%~dp0bin\ffmpeg.exe"

if not exist "%FFMPEG_PATH%" (
  where ffmpeg >nul 2>nul
  if errorlevel 1 (
    echo Missing ffmpeg
    echo Install ffmpeg or put ffmpeg.exe in the bin folder.
    pause
    exit /b 1
  )
  set "FFMPEG_PATH=ffmpeg"
)

if exist "%NODE_EXE%" goto run
where node >nul 2>nul
if errorlevel 1 (
  echo Missing Node.js
  echo Install Node.js or put node.exe in the bin folder.
  pause
  exit /b 1
)
set "NODE_EXE=node"

:run
echo TrackSplit Studio is running at:
echo http://127.0.0.1:4173/index.html
echo.
echo Keep this window open while using the web page.
echo Press Ctrl+C to stop.
echo.
"%NODE_EXE%" server.js
