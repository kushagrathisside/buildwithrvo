# Proctoring POC Execution & Run Guide (V2)

Follow this guide to start, run, test, and customize the online exam proctoring POC V2.

---

## 🚀 Unified Execution (Recommended)

First, clone the repository:
```bash
git clone https://github.com/kushagrathisside/buildwithrvo
cd buildwithrvo
```

You can launch all components of the POC (the FastAPI server, the gRPC AI service, the React Frontend, and the RVO engine) in a single command using our unified launcher script. 

Run the following command from the root of the `buildwithrvo` directory:
```bash
./run_poc.sh
```

This script will start the background services, wait for them to initialize, install dependencies, display connection health details, boot up the RVO engine, and **automatically clean up all processes when you press `CTRL+C`**.

---

## 🧪 Running Automated Tests

V2 includes a comprehensive test suite to validate backend API logic and frontend UI workflows.

To execute the full test suite (Pytest + Playwright E2E), run:
```bash
./run_tests.sh
```
This automatically boots a test database, starts isolated FastAPI test servers, runs backend integration tests, executes Playwright E2E interactions on the Chromium browser, and generates an HTML test report.

---

## 🛠️ Manual Execution (For Debugging)

If you prefer to inspect output logs for each service separately, open multiple terminal tabs and run:

### Terminal 1: Start the Dashboard Backend API & Streamer
```bash
./venv/bin/python poc-dashboard/server.py
```

### Terminal 2: Start the gRPC AI Service
```bash
./venv/bin/python ai-service/app_service.py
```

### Terminal 3: Start the Async Clip Worker
```bash
./venv/bin/python ai-service/clip_worker.py
```

### Terminal 4: Start the React Frontend
```bash
cd poc-dashboard-v2
npm run dev
```

### Terminal 5: Run the RVO Core Engine
```bash
cd rvo-deployment
./rvo-bin --config config/rvo-remote.yaml
```

---

## 📺 Reviewing Results

Once all modules are running:
1. Open your browser and navigate to **`http://localhost:5173`** (if using the unified script or `npm run dev`).
2. Check the **Health Badges** in the top right to verify both the RVO Engine and the AI gRPC Service are online.
3. Observe **Live Metrics** updating as the scheduler ticks.
4. Use the **Source Dropdown** to instantly switch the video source from the live webcam to simulated MP4 feeds.
5. As the engine runs, if an infraction occurs, the async AI worker generates a detailed violation report. The FastAPI server streams this data via **Server-Sent Events (SSE)**, creating a new incident card instantly.
6. Select any incident card from the feed and click **Play** to review the frame playback with bounding boxes scaled and drawn dynamically over the canvas.

---

## 📷 Switching to a Physical Webcam

The POC is configured by default to read a physical camera stream or a simulated MP4 via the frontend dropdown. 

If you want to manually hardcode the engine to use a physical device:

1. Open `rvo-deployment/config/rvo-remote.yaml`.
2. Replace the `camera` config block:
   ```yaml
   # Change to local webcam:
   camera:
     device_index: 0
   ```
3. RVO will capture frames directly from your physical webcam! You can hold a cell phone in front of the camera or look away to trigger live events and see them render in real-time on your dashboard.
