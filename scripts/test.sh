#!/bin/bash
# Test Runner Script
# Always rebuilds the test container before running tests

set -e

echo "🔨 Building test container..."
docker compose build tester-container

echo ""
echo "🧪 Running tests..."
docker compose run --rm tester-container npm run test:all

echo ""
echo "✅ Tests complete!"
