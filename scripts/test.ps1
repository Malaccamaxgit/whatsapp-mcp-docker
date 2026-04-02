# Test Runner Script
# Always rebuilds the test container before running tests

Write-Host "🔨 Building test container..." -ForegroundColor Cyan
docker compose build tester-container

Write-Host ""
Write-Host "🧪 Running tests..." -ForegroundColor Cyan
docker compose run --rm tester-container npm run test:all

Write-Host ""
Write-Host "✅ Tests complete!" -ForegroundColor Green
