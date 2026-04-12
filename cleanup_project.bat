@echo off
echo Cleaning up project files...

echo Removing node_modules...
rmdir /s /q node_modules
if exist node_modules (
    echo FAILED to remove node_modules. Please stop any running dev servers (Ctrl+C) and try again.
    pause
    exit /b 1
)

echo Removing client/node_modules...
rmdir /s /q client\node_modules

echo Removing playwright-report...
rmdir /s /q playwright-report

echo Removing test-results...
rmdir /s /q test-results

echo Cleanup complete! You can now zip the project.
pause
