# Realtime Video Orchestrator (RVO) — Proctoring POC

Welcome to the RVO AI Proctoring Proof-of-Concept! This repository demonstrates how the ultra-low latency **RVO Core Engine** (written in Rust) seamlessly integrates with an external **Python AI gRPC Service** (YOLOv8 + Haar Cascades) and a beautiful **FastAPI + Vanilla JS Dashboard**.

## 🚀 Quick Start

To run this repository locally, first clone it:
```bash
git clone https://github.com/kushagrathisside/buildwithrvo
cd buildwithrvo
```

To launch the entire ecosystem (AI Service, Dashboard, and RVO Engine) with a single click:

```bash
./run_poc.sh
```

*(Note: On your first run, the script will automatically build a Python virtual environment and install all dependencies from `requirements.txt`).*

Once you see `✅ Services online!`, open your browser to:
👉 **[http://localhost:8000](http://localhost:8000)**

## ✨ Features
* **Zero-Copy Engine Integration:** RVO reads your webcam and sends raw frames to the Python AI service via fast gRPC multiplexing.
* **Dynamic Video Source Switching:** Use the dropdown in the dashboard to instantly switch between your Live Webcam and predefined Sample Videos!
* **Edge Encoding:** Violations trigger the Rust engine to natively slice and encode `.mp4` evidence clips with zero framerate drops.
* **Premium Dashboard UI:** Review flagged infractions instantly with a bespoke glassmorphism UI.

## 📂 Repository Layout
- `ai-service/`: The Python gRPC server running YOLOv8 (Phone Detection) and Haar Cascades (Face Anomaly Detection).
- `poc-dashboard/`: The FastAPI backend and HTML/CSS/JS frontend for the UI.
- `rvo-deployment/`: The compiled Rust `rvo-bin` executable and its configuration files.
- `samplevideos/`: MP4 files used to test dynamic source switching in the dashboard.
- `docs/`: Technical guides and architecture diagrams.

## 🛠 Stopping the System
Simply press `CTRL+C` in the terminal where `./run_poc.sh` is running. The script will safely terminate the dashboard, AI service, and release the camera lock from the RVO engine.

---

## ⚠️ Known V1 Architectural Issues
This branch (`v1`) represents the initial Proof of Concept. The following architectural limitations have been identified and are slated for the `v2` redesign:

1. **Heavy Inference in the API Layer**: The FastAPI server synchronously runs YOLOv8 and Haar Cascades on every frame when fetching incidents, severely blocking the event loop and causing high latency.
2. **Filesystem as a Database**: The server scans `clips/demo/` for every API request instead of querying a proper database like PostgreSQL, causing terrible disk I/O performance at scale.
3. **Aggressive HTTP Polling**: The frontend uses `setInterval` to poll the API every 2 seconds. V2 should implement WebSockets for realtime event-driven updates.
4. **Inefficient Media Delivery**: The frontend fetches hundreds of individual JPEG images via HTTP instead of streaming an encoded `.mp4` video.
5. **Vanilla JS Spaghetti State**: The complex frontend state is managed via imperative DOM manipulation in a single `app.js` file, lacking the robust state management of a reactive framework (e.g. React/Next.js).
