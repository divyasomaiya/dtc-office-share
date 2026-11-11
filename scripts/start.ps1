# DTC Office Share - PowerShell Startup Script
[CmdletBinding()]
param (
    [int]$Port = 3000,
    [string]$HostAddress = "0.0.0.0"
)

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "           DTC Office Share - Phase 1               " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# Verify Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js (v18+) from https://nodejs.org/"
    Read-Host "Press Enter to exit"
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

# Check node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install --production
}

$env:PORT = $Port.ToString()
$env:HOST = $HostAddress

Write-Host "Starting server on ${HostAddress}:${Port}..." -ForegroundColor Green
node src/server.js
