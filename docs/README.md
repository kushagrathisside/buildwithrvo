# RVO AI Proctoring POC Documentation

This folder contains the documentation for the Real-time Online Exam Proctoring POC built on top of the **Realtime Video Orchestration (RVO)** engine.

## 🛡️ Project Overview

The goal of this POC is to demonstrate how the low-latency RVO scheduling engine can orchestrate complex computer vision models (such as YOLOv8 and Haar Cascades) to enforce online exam integrity.

Rather than running heavy deep learning models directly on the hot camera ingestion loop, this implementation showcases **decoupled inference** over a gRPC gateway. Slow model evaluations run out-of-process, allowing the orchestrator's tick loop to remain bounded under 1 ms while preserving frame rate stability.

---

## 📂 POC Directory Structure

```text
buildwithrvo/
├── ai-service/              # gRPC AI Detection Service (Python)
│   ├── app_service.py       # Main gRPC server using YOLOv8 & Haar Cascades
│   ├── detector.proto       # Service definition contract
│   ├── detector_pb2.py      # Generated Protobuf bindings
│   ├── detector_pb2_grpc.py # Generated gRPC bindings
│   └── yolov8n.pt           # YOLOv8 nano pre-trained model file
│
├── poc-dashboard/           # Web Interface & Backend API Server (FastAPI)
│   ├── server.py            # API server, metrics proxy, and MJPEG streamer
│   └── static/              # Glassmorphic Frontend Web assets
│       ├── index.html       # HTML Layout
│       ├── style.css        # Cyberpunk Dark CSS styling
│       └── app.js           # Interactive playback & metrics logic
│
├── rvo-deployment/          # RVO engine run environment & binaries
│   ├── rvo-bin              # Precompiled RVO core daemon
│   ├── rvo-tui              # Terminal dashboard monitor
│   ├── rvo-web              # Embedded RVO web dashboard
│   ├── config/              
│   │   └── rvo-remote.yaml  # Config routing frames to our gRPC port (50051)
│   └── clips/               
│       └── demo/            # Output directory for flagged infraction clips
│
├── docs/                    # POC documentation guides
│   ├── README.md            # Overview (this file)
│   ├── ARCHITECTURE.md      # Data flow & signal mappings
│   └── RUN_GUIDE.md         # Deployment & execution walkthrough
│
└── venv/                    # Local Python virtual environment
```

---

## 📖 Available Guides

* **[ARCHITECTURE.md](ARCHITECTURE.md):** Understand the signal flow from camera ingestion to canvas drawing, and how proctoring infractions are mapped to RVO primitives.
* **[RUN_GUIDE.md](RUN_GUIDE.md):** Detailed step-by-step instructions on booting the services, triggering events, and reviewing playback results.
