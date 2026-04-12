@echo off
set "PORT=5000"

echo Verificando se a porta %PORT% esta ocupada...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":%PORT%" ^| find "LISTENING"') do (
    echo Matando processo PID %%a usando a porta %PORT%...
    taskkill /F /PID %%a
)

echo Iniciando servidor...
npm run dev
