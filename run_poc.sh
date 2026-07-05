#!/usr/bin/env bash
#
# Launcher script for the RVO AI Proctoring POC
#
# Starts:
#  1. gRPC AI detection service (:50051)
#  2. FastAPI dashboard backend (:8000)
#  3. RVO Core Engine (processes camera feed & metrics)
#
# Automatically cleans up ALL processes (including camera lock) on CTRL+C or crash.

# Use pipefail to catch pipe errors, but NOT set -e which would abort on expected non-zero exits
set -uo pipefail

# Base directory setup
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR"

# PIDs list to clean up on exit
PIDS=()
RVO_PGID=""

cleanup() {
    # Clear traps to prevent recursive execution
    trap - SIGINT SIGTERM EXIT
    echo -e "\n🛑 Stopping RVO Proctoring POC services..."

    # 1. Kill any running RVO engine process (since FastAPI can now restart it dynamically)
    pkill -15 -f rvo-bin 2>/dev/null || true

    # 2. Send SIGTERM to remaining services in reverse dependency order
    for ((i=${#PIDS[@]}-1; i>=0; i--)); do
        pid="${PIDS[i]}"
        if kill -0 "$pid" 2>/dev/null; then
            kill -15 "$pid" 2>/dev/null || true
        fi
    done

    # 3. Wait up to 2 seconds for clean exit
    for ((t=0; t<4; t++)); do
        alive=0
        for pid in "${PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then alive=1; fi
        done
        if pgrep -f rvo-bin >/dev/null; then alive=1; fi
        [ $alive -eq 0 ] && break
        sleep 0.5
    done

    # 4. Force-kill any still-running processes
    pkill -9 -f rvo-bin 2>/dev/null || true
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done

    echo "✅ All services stopped. Camera released."
}

# Trap SIGINT, SIGTERM, and EXIT
trap cleanup SIGINT SIGTERM EXIT

echo "🚀 Starting RVO Proctoring POC services..."

# 0. Environment Setup
if [ ! -d "venv" ]; then
    echo "📦 Creating Python virtual environment and installing dependencies..."
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    ./venv/bin/pip install -r requirements.txt
fi

# 1. Start the gRPC AI detection service in the background
echo "⚡ Starting gRPC AI Service (:50051)... (logging to ai_service.log)"
./venv/bin/python ai-service/app_service.py > ai_service.log 2>&1 &
AI_PID=$!
PIDS+=($AI_PID)

# 2. Start the FastAPI dashboard backend in the background
echo "📊 Starting FastAPI Dashboard Server (:8000)... (logging to dashboard_server.log)"
./venv/bin/python poc-dashboard/server.py > dashboard_server.log 2>&1 &
DASH_PID=$!
PIDS+=($DASH_PID)

# 3. Wait for FastAPI to be ready (with timeout — won't hang forever)
echo "⏳ Waiting for services to initialize..."
WAIT=0
until curl -s http://localhost:8000/api/status > /dev/null 2>&1; do
    sleep 0.5
    WAIT=$((WAIT + 1))
    if [ $WAIT -gt 40 ]; then
        echo "❌ Timeout: FastAPI dashboard failed to start. Check dashboard_server.log"
        exit 1
    fi
done

# 4. Wait for gRPC service to be ready (with timeout)
WAIT=0
until ./venv/bin/python -c "import socket; s=socket.socket(); s.settimeout(0.1); s.connect(('127.0.0.1',50051)); s.close()" > /dev/null 2>&1; do
    sleep 0.5
    WAIT=$((WAIT + 1))
    if [ $WAIT -gt 40 ]; then
        echo "❌ Timeout: gRPC AI service failed to start. Check ai_service.log"
        exit 1
    fi
done

echo "✅ Services online!"
echo "🖥️  Proctoring Dashboard available at: http://localhost:8000"
echo "⚙️  RVO engine starting. Press CTRL+C to stop all services."
echo "--------------------------------------------------------"

# 5. Start RVO Core Engine in its own process group (setsid) for reliable process group kill
cd rvo-deployment

# Rotate previous events.jsonl to prevent unbounded log growth across sessions
if [ -s events.jsonl ]; then
    ARCHIVE_NAME="events_$(date +%Y%m%d_%H%M%S).jsonl"
    mv events.jsonl "$ARCHIVE_NAME"
    echo "📁 Archived previous event log to $ARCHIVE_NAME"
fi

setsid ./rvo-bin --config config/rvo-remote.yaml &
RVO_PID=$!
PIDS+=($RVO_PID)

# Keep script alive and responsive to traps while allowing FastAPI to restart RVO
while true; do
    sleep 1
done
