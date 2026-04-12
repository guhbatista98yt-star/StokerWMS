@echo off
cd /d "%~dp0"
title Stoker WMS - Instalador do Agente de Impressao
echo.
echo ============================================================
echo   Stoker WMS -- Instalador do Agente de Impressao
echo ============================================================
echo.

:: Verifica se Python esta instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado!
    echo.
    echo Baixe e instale o Python em: https://www.python.org/downloads/
    echo Marque a opcao "Add Python to PATH" durante a instalacao.
    echo.
    pause
    exit /b 1
)

echo [OK] Python encontrado.
echo.

:: Instala dependencias
echo Instalando dependencias...
pip install -r requirements.txt
if errorlevel 1 (
    echo [AVISO] Algumas dependencias podem nao ter sido instaladas.
)

echo.
echo [OK] Dependencias instaladas.
echo.

:: Verifica config
if not exist config.ini (
    echo [ERRO] Arquivo config.ini nao encontrado!
    echo Edite o arquivo config.ini com o servidor e token corretos.
    pause
    exit /b 1
)

:: Verifica se o token foi configurado
findstr /C:"COLE_O_TOKEN_AQUI" config.ini >nul
if not errorlevel 1 (
    echo [AVISO] Voce ainda nao configurou o token no config.ini!
    echo.
    echo 1. Abra config.ini com um editor de texto
    echo 2. Substitua COLE_O_TOKEN_AQUI pelo token gerado no sistema
    echo 3. Configure tambem o server_url com a URL do servidor
    echo.
    pause
    exit /b 1
)

echo ============================================================
echo   Configuracao OK! Iniciando agente...
echo   Pressione Ctrl+C para parar.
echo ============================================================
echo.

python agent.py

pause
