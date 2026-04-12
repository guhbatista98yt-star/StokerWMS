@echo off
cd /d "%~dp0"
title Stoker WMS - Agente de Impressao [%COMPUTERNAME%]
python agent.py
pause
