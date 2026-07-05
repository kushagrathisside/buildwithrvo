# Proctoring POC Execution & Run Guide

Follow this guide to start, run, and customize the online exam proctoring POC.

---

## 🚀 Unified Execution (Recommended)

First, clone the repository:
```bash
git clone https://github.com/kushagrathisside/buildwithrvo
cd buildwithrvo
```

You can launch all three components of the POC (the FastAPI server, the gRPC AI service, and the RVO engine) in a single command using our unified launcher script. 

Run the following command from the root of the `buildwithrvo` directory:
```bash
./run_poc.sh
```

This script will start the background services, wait for them to initialize, display connection health details, boot up the RVO engine, and **automatically clean up all processes when you press `CTRL+C`**.

---

## 🛠️ Manual Execution (For Debugging)

If you prefer to inspect output logs for each service separately, you can open three terminal tabs and run:

### Terminal 1: Start the Dashboard Backend & Video Streamer
```bash
./venv/bin/python poc-dashboard/server.py
```

### Terminal 2: Start the gRPC AI Service
```bash
./venv/bin/python ai-service/app_service.py
```

### Terminal 3: Run the RVO Core Engine
```bash
cd rvo-deployment
./rvo-bin --config config/rvo-remote.yaml
```

---

## 📺 Reviewing Results

Once all three modules are running:
1. Open your browser and navigate to **`http://localhost:8000`**.
2. Check the **Health Badges** in the top right to verify both RVO and the AI Service are online.
3. Observe **Live Metrics** updating as the scheduler ticks.
4. As the engine runs, it will detect that there are 0 faces in the preview video feed. This will trigger a `Face Anomaly` violation after 1 second, producing a new clip folder inside the **Incidents Feed**.
5. Select any incident card from the feed and click **Play** to review the frame playback with bounding boxes drawn over the canvas in real-time.

---

## 📷 Switching to a Physical Webcam

The POC is configured by default to read a simulated MJPEG stream (`http://localhost:8000/api/video_feed`) so that it can run headlessly on server environments without camera hardware. 

If you are running this locally on a machine with a built-in webcam or camera device, you can easily switch it back to a live video source:

1. Open [rvo-remote.yaml](file:///home/pro2024001/buildwithrvo/rvo-deployment/config/rvo-remote.yaml).
2. Replace the `camera` config block:
   ```yaml
   # Change from HTTP stream:
   camera:
     source_uri: "http://localhost:8000/api/video_feed"
   ```
   ```yaml
   # Change to local webcam:
   camera:
     device_index: 0
   ```
3. Restart the RVO engine binary: `./rvo-bin --config config/rvo-remote.yaml`.
4. Now, RVO will capture frames directly from your physical webcam! You can hold a cell phone in front of the camera or look away to trigger live events and see them render in real-time on your dashboard.
