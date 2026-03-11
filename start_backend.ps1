# Start Node.js backend
Write-Host "Starting Nykaa BI Dashboard Backend (Node.js) on http://localhost:8000" -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\nodebackend"
npm run dev
