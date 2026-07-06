# RVO AI Proctoring POC Documentation (V2)

This folder contains the documentation for the Real-time Online Exam Proctoring POC built on top of the **Realtime Video Orchestration (RVO)** engine.

## 🛡️ Project Overview

The goal of this POC is to demonstrate how the low-latency RVO scheduling engine can orchestrate complex computer vision models (such as YOLOv8 and Haar Cascades) to enforce online exam integrity.

Rather than running heavy deep learning models directly on the hot camera ingestion loop, this implementation showcases **decoupled inference** over a gRPC gateway. Slow model evaluations run out-of-process, allowing the orchestrator's tick loop to remain bounded under 1 ms while preserving frame rate stability.

---

## 📂 POC Directory Structure

```text
buildwithrvo/
├── ai-service/              # gRPC AI Detection Service & Workers (Python)
│   ├── app_service.py       # Main gRPC server using YOLOv8 & Haar Cascades
│   ├── clip_worker.py       # Background daemon parsing AI violation clips
│   ├── detector.proto       # Service definition contract
│   └── yolov8n.pt           # YOLOv8 nano pre-trained model file
│
├── poc-dashboard/           # Backend API Server (FastAPI)
│   ├── server.py            # REST API, SSE streamer, and metrics proxy
│   └── database.py          # SQLite database connection & schema
│
├── poc-dashboard-v2/        # Frontend React Web Client (Vite)
│   ├── src/App.jsx          # Main React Application
│   └── src/index.css        # Premium Glassmorphism UI Styles
│
├── rvo-deployment/          # RVO engine run environment & binaries
│   ├── rvo-bin              # Precompiled RVO core daemon
│   └── config/              
│       └── rvo-remote.yaml  # Config routing frames to our gRPC port (50051)
│
├── tests/                   # Comprehensive Test Suite
│   ├── backend/             # Pytest tests for API and Workers
│   └── e2e/                 # Playwright tests for Frontend Workflows
│
└── docs/                    # POC documentation guides
    ├── README.md            # Overview (this file)
    ├── ARCHITECTURE.md      # Data flow & signal mappings
    └── RUN_GUIDE.md         # Deployment & execution walkthrough
```

---

## 📖 Available Guides

* **[ARCHITECTURE.md](ARCHITECTURE.md):** Understand the signal flow from camera ingestion to Canvas rendering, and how the asynchronous V2 database/SSE integration works.
* **[RUN_GUIDE.md](RUN_GUIDE.md):** Detailed step-by-step instructions on booting the services, testing the system, and interacting with the React client.
