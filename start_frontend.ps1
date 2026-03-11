# Start frontend (run this second, in a new terminal)
Write-Host "Starting Nykaa BI Dashboard Frontend..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\frontend"
npm run dev
