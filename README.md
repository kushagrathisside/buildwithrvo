# Realtime Video Orchestrator (RVO) — Proctoring POC (V2)

Welcome to the RVO AI Proctoring Proof-of-Concept! This repository demonstrates how the ultra-low latency **RVO Core Engine** seamlessly integrates with an external **Python AI gRPC Service** (YOLOv8 + Haar Cascades) and a beautiful **React (Vite) + FastAPI Dashboard**.

## 🚀 Quick Start

To run this repository locally, first clone it:
```bash
git clone https://github.com/kushagrathisside/buildwithrvo
cd buildwithrvo
```

To launch the entire ecosystem (AI Service, FastAPI Backend, React Frontend, and RVO Engine) with a single click:

```bash
./run_poc.sh
```

*(Note: On your first run, the script will automatically build a Python virtual environment, install backend dependencies from `requirements.txt`, and install frontend NPM dependencies).*

Once you see `✅ Services online!`, open your browser to:
👉 **[http://localhost:5173](http://localhost:5173)**

## ✨ V2 Architecture Features
* **Zero-Copy Engine Integration:** RVO reads your webcam and sends raw frames to the Python AI service via fast gRPC multiplexing.
* **React + Vite Frontend:** A robust, state-driven, component-based frontend with a premium Glassmorphism UI.
* **Server-Sent Events (SSE):** Real-time, push-based communication from FastAPI to the frontend for instant incident and metrics updates without polling.
* **Asynchronous AI Processing:** The API layer is lightweight; a dedicated background `clip_worker.py` watches for flagged events and processes YOLOv8 inference asynchronously.
* **SQLite Database:** Incidents are persisted and queried from a structured SQLite database (`dashboard.db`) instead of scanning the file system.
* **Comprehensive Testing Suite:** Full backend testing via `pytest` and frontend E2E testing via `Playwright`.

## 📂 Repository Layout
- `ai-service/`: The Python gRPC server (`app_service.py`) and background clip analyzer (`clip_worker.py`).
- `poc-dashboard/`: The FastAPI backend serving REST APIs, SSE streams, and SQLite database connectivity.
- `poc-dashboard-v2/`: The React + Vite frontend application.
- `rvo-deployment/`: The compiled Rust `rvo-bin` executable and its configuration files.
- `tests/`: Automated test suites (`pytest` for backend, `Playwright` for frontend E2E).
- `docs/`: Technical guides and architecture diagrams.

## 🛠 Stopping the System
Simply press `CTRL+C` in the terminal where `./run_poc.sh` is running. The script will safely terminate the frontend, dashboard, AI services, and release the camera lock from the RVO engine.

## 🧪 Running the Tests
To run the full suite of backend and frontend tests sequentially:
```bash
./run_tests.sh
```
