@echo off
setlocal
set "HUB_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\pythonw.exe"
if exist "%HUB_PYTHON%" (
    start "" "%HUB_PYTHON%" "%~dp0scripts\open-hub.py"
) else (
    start "" pythonw.exe "%~dp0scripts\open-hub.py"
)
