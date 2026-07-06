# Realtime Video Orchestrator (RVO) Proctoring Framework

The **RVO Proctoring Framework** is an end-to-end, ultra-low latency computer vision pipeline designed for real-time exam integrity monitoring. Built on top of the highly deterministic **RVO Core Engine**, this framework provides a decoupled architecture for applying complex deep learning models (such as YOLOv8) to streaming camera feeds without introducing frame-rate latency or head-of-line blocking.

This repository serves as the official implementation and Proof-of-Concept (POC) for V2 of the RVO Proctoring Architecture, demonstrating seamless integration between the Rust-based ingestion engine, a gRPC AI microservice, and a reactive React/FastAPI dashboard.

---

## Architecture Overview

The system is designed around a microservices architecture to ensure high throughput and fault tolerance:

1. **RVO Core Engine (Rust):** Handles hardware video ingestion, framerate pacing (scheduler ticking at 1ms), and event triggering. It communicates asynchronously with the AI models via a lock-free gRPC mailbox.
2. **AI Inference Service (Python):** A stateful gRPC server executing YOLOv8 (Mobile Phone Detection) and Haar Cascades (Face Anomaly Detection). Inference results are cached per-frame to minimize computational overhead.
3. **Background Clip Worker:** An asynchronous daemon that monitors the RVO event bus. When an infraction is detected, it processes the raw frames into persistent metadata and logs it into an optimized SQLite database.
4. **Dashboard Backend (FastAPI):** Exposes RESTful APIs and Server-Sent Events (SSE) for zero-polling, real-time metrics, and incident reporting.
5. **Client Application (React/Vite):** A responsive, state-driven user interface featuring dynamically scaled HTML5 Canvas rendering for bounding boxes and live metrics visualization.

---

## Installation

### Prerequisites
Before running the RVO Proctoring Framework, ensure your system meets the following requirements:
* **Operating System:** Linux (Ubuntu 22.04+ recommended)
* **Python:** Version 3.11 or higher
* **Node.js:** Version 20 or higher
* **System Libraries:** GStreamer, OpenCV dependencies (`libgl1-mesa-glx`, `libglib2.0-0`)

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kushagrathisside/buildwithrvo.git
   cd buildwithrvo
   ```

2. **Launch the ecosystem:**
   The framework provides a unified bootstrapping script that automatically provisions Python virtual environments, resolves dependencies, and orchestrates the microservices.
   ```bash
   ./run_poc.sh
   ```

   > **Note:** The initial execution may take a few minutes as it downloads the YOLOv8 model weights and compiles required node modules.

3. **Access the Dashboard:**
   Upon successful initialization, the dashboard will be available at:
   **[http://localhost:5173](http://localhost:5173)**

---

## Directory Structure

The repository is modularized into distinct logical domains:

* `ai-service/` — Inference definitions, gRPC bindings, and the asynchronous `clip_worker` daemon.
* `poc-dashboard/` — The FastAPI backend, SQLite schema definitions, and SSE routing logic.
* `poc-dashboard-v2/` — The React client application, Vite configuration, and frontend styling.
* `rvo-deployment/` — The compiled RVO Core binary and its YAML configuration manifests.
* `tests/` — The Continuous Integration (CI) test suite.
* `docs/` — In-depth architectural references and deployment manuals.

---

## Testing

The framework includes a comprehensive test suite covering backend logic and frontend User Experience (UX).

To execute the tests (Pytest + Playwright E2E):
```bash
./run_tests.sh
```

---

## Documentation

For a deep dive into the system's inner workings, refer to the official documentation guides:
* [Architecture & Signal Flow](docs/ARCHITECTURE.md) - Detailed breakdown of the event loop and inference decoupling.
* [Execution Guide](docs/RUN_GUIDE.md) - Advanced manual deployment, debugging, and configuration routing.

## License
Provided as an internal Proof of Concept. All rights reserved.
