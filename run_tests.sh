#!/usr/bin/env bash

set -e

echo "====================================="
echo "🧪 Starting RVO Test Suite Execution "
echo "====================================="

# 1. Run Python Backend Tests (Pytest)
echo -e "\n1️⃣ Running Backend Pytest Suite..."
./venv/bin/pytest tests/backend/ -v
if [ $? -ne 0 ]; then
    echo "❌ Backend tests failed. Aborting E2E suite."
    exit 1
fi
echo "✅ Backend tests passed!"

# 2. Run Playwright E2E Tests
# Playwright config starts the Vite and FastAPI servers automatically
echo -e "\n2️⃣ Running Frontend E2E Playwright Suite..."
npx playwright install chromium
npx playwright test --config=tests/e2e/playwright.config.js
if [ $? -ne 0 ]; then
    echo "❌ Frontend E2E tests failed."
    exit 1
fi
echo "✅ Frontend E2E tests passed!"

echo -e "\n🎉 All tests passed successfully!"
