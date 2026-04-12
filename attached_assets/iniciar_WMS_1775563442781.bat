@echo off
setlocal EnableExtensions

REM UTF-8
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

set "APP_DIR=C:\Users\SERVIDOR03\Desktop\GLA_WMS_Test"

if not exist "%APP_DIR%\sync_db2.py" (
  echo ERRO: Nao encontrei sync_db2.py em: "%APP_DIR%"
  exit /b 1
)

pushd "%APP_DIR%" || (echo ERRO: nao entrou no diretorio & exit /b 1)

REM Usa o DEFAULT de 300s (nao passa --loop)
python -X utf8 sync_db2.py --serve

popd
endlocal
