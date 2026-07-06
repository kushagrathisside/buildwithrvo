# Deployment and Execution Guide

This document provides standardized procedures for deploying, validating, and debugging the RVO Proctoring Framework. 

## Automated Execution (Recommended)

For rapid evaluation and localized testing, the repository provides a unified orchestration script. This script automatically handles dependency resolution, virtual environment provisioning, and daemon lifecycle management.

Execute the following command from the repository root:

```bash
./run_poc.sh
```

**Boot Sequence:**
1. The script provisions a Python `venv` and installs dependencies defined in `requirements.txt`.
2. NPM dependencies are installed for the React client.
3. The AI Inference Server (`app_service.py`) and Background Daemon (`clip_worker.py`) are spawned as background jobs.
4. The FastAPI Gateway (`server.py`) and Vite Dev Server are initialized.
5. The Rust RVO Engine is compiled (if necessary) and executed.
6. The script intercepts `SIGINT` (CTRL+C) to guarantee graceful termination of all child processes.

Upon successful execution, the interface is accessible at: **[http://localhost:5173](http://localhost:5173)**

---

## Testing Pipeline

The framework is bundled with a deterministic Continuous Integration (CI) test suite that validates the integration between the backend data stores and the React rendering layer.

To execute the full test suite locally:

```bash
./run_tests.sh
```

**Test Coverage:**
* **Pytest (Backend):** Validates REST endpoints, SQLite concurrency, and edge cases in the `clip_worker` inference logic.
* **Playwright (Frontend E2E):** Boots headless Chromium instances to simulate user interactions, verifying that Server-Sent Events successfully hydrate the DOM and trigger Canvas rerenders.

---

## Manual Execution (Debugging Mode)

For granular debugging and log inspection, it is often necessary to run the microservices in isolated terminal sessions. Ensure that the Python virtual environment is activated (`source venv/bin/activate`) before proceeding.

### 1. Initialize the FastAPI Gateway
```bash
python poc-dashboard/server.py
```
*Expected Output:* Uvicorn running on port 8000.

### 2. Initialize the AI Inference Server
```bash
python ai-service/app_service.py
```
*Expected Output:* gRPC Server listening on port 50051.

### 3. Initialize the Clip Worker Daemon
```bash
python ai-service/clip_worker.py
```
*Expected Output:* Watchdog observing the `/rvo-deployment/clips/demo` directory.

### 4. Initialize the React Client
```bash
cd poc-dashboard-v2
npm run dev
```
*Expected Output:* Vite server listening on port 5173.

### 5. Initialize the RVO Engine
```bash
cd rvo-deployment
./rvo-bin --config config/rvo-remote.yaml
```
*Expected Output:* RVO Core binding to camera index / HTTP stream.

---

## Hardware Configuration (Webcam Integration)

By default, the framework is configured to ingest a synthetic MP4 stream to allow headless execution on CI runners. To transition the framework to monitor physical hardware (e.g., a local USB Webcam):

1. Open the primary configuration manifest: `rvo-deployment/config/rvo-remote.yaml`.
2. Locate the `camera` block and replace the `source_uri` with a `device_index`:

   **Before (Synthetic Stream):**
   ```yaml
   camera:
     source_uri: "http://localhost:8000/api/video_feed"
   ```

   **After (Physical Hardware):**
   ```yaml
   camera:
     device_index: 0
   ```
3. Restart the RVO Engine. The framework will now ingest raw frames from your `/dev/video0` or equivalent OS-level video interface.
