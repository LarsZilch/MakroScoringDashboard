@echo off
setlocal

cd /d "%~dp0"

echo Starte Makro-Scoring ^& Regime-Check ...
echo.

if not exist node_modules (
    echo node_modules fehlt, installiere Abhaengigkeiten ...
    call npm install
    if errorlevel 1 (
        echo.
        echo Installation fehlgeschlagen. Fenster bleibt offen.
        pause
        exit /b 1
    )
)

REM Server + Frontend zusammen starten (npm run dev), in eigenem Fenster,
REM damit dieses Fenster den Browser oeffnen kann, ohne zu blockieren.
start "Makro-Scoring · Server + Web" cmd /k npm run dev

echo Warte, bis die Web-Oberflaeche erreichbar ist ...
timeout /t 5 /nobreak >nul

start "" "http://localhost:5177"

echo.
echo Fertig. Die Anwendung laeuft im separaten Fenster "Makro-Scoring · Server + Web".
echo Zum Beenden dieses Fenster schliessen.
pause >nul
