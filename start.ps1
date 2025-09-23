# requires: dependencies installed already
$ErrorActionPreference = "Stop"

# kill existing dev servers on default ports (optional lightweight)
function Stop-Port($port) {
	$proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
	if ($proc) { Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue }
}

# Stop-Port 8000
# Stop-Port 5173

Write-Host "Starting backend..."
Start-Process -NoNewWindow -FilePath pwsh -ArgumentList "-NoExit","-Command","cd backend; if (!(Test-Path .venv)) {python -m venv .venv}; . .venv/Scripts/Activate.ps1; pip install -r requirements.txt; uvicorn app.main:app --host 0.0.0.0 --port 8000" | Out-Null

Start-Sleep -Seconds 2

Write-Host "Starting frontend..."
Start-Process -NoNewWindow -FilePath pwsh -ArgumentList "-NoExit","-Command","cd frontend; if (!(Test-Path node_modules)) {npm i}; npm run dev" | Out-Null

Write-Host "tiny-sola started. Frontend: http://localhost:5173" 