#!/usr/bin/env bash

set -e

echo "====================================="
echo "🧪 Starting RVO Test Suite Execution "
echo "====================================="

# 1. Spin up background AI services for E2E integration
echo -e "\n⚙️ Starting background AI services (gRPC & Clip Worker)..."
PYTHONPATH=$(pwd)/ai-service ./venv/bin/python ai-service/app_service.py > tests_ai_service.log 2>&1 &
APP_PID=$!

PYTHONPATH=$(pwd)/ai-service ./venv/bin/python ai-service/clip_worker.py > tests_clip_worker.log 2>&1 &
WORKER_PID=$!

cleanup() {
    echo -e "\n🧹 Cleaning up background services..."
    kill $APP_PID 2>/dev/null || true
    kill $WORKER_PID 2>/dev/null || true
    pkill -9 -f "rvo-bin" 2>/dev/null || true
}
trap cleanup EXIT

# 2. Run Python Backend Tests (Pytest)
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
