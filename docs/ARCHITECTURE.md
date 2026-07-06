# POC Architecture & Signal Flow (V2)

This document details the end-to-end data flow and signal mapping logic implemented in the proctoring POC V2.

---

## 🔄 End-to-End Data Flow

```text
+---------------------------------------------------------------------------------------+
|                                    RVO Core Engine                                    |
|  - Ingests frames from webcam or MP4 samples into a circular buffer.                  |
|  - Sequential 1 ms scheduler tick checks FPS limits and signal dependencies.          |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (Async gRPC mailbox fan-out / 15 FPS)
                                           v
+---------------------------------------------------------------------------------------+
|                                gRPC AI Service (:50051)                               |
|  - Decode JPEG bytes -> Runs YOLOv8 and Haar Cascades.                                |
|  - Returns lists of SignalOut values (PersonDetected and FacePresent).                |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (gRPC Response)
                                           v
+---------------------------------------------------------------------------------------+
|                               RVO Event & Clip Manager                                |
|  - Event Engine checks rules: sustained signal for 1000 ms triggers an infraction.    |
|  - Clip Manager locks buffer, slices the window, writes frames + meta.json to disk.   |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (Filesystem drop into clips/demo/)
                                           v
+---------------------------------------------------------------------------------------+
|                           Async Clip Worker (clip_worker.py)                          |
|  - Watchdog daemon detects new clips instantly.                                       |
|  - Runs comprehensive YOLOv8 AI verification across all frames in the clip.           |
|  - Inserts finalized JSON metadata and telemetry into SQLite Database.                |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (SQLite INSERT)
                                           v
+---------------------------------------------------------------------------------------+
|                            FastAPI Backend Server (:8000)                             |
|  - Streams new SQLite incidents down to the frontend via Server-Sent Events (SSE).    |
|  - Proxies Prometheus telemetry metrics from RVO Engine to the frontend.              |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (HTTP / SSE / REST APIs)
                                           v
+---------------------------------------------------------------------------------------+
|                                React Frontend (:5173)                                 |
|  - Receives SSE updates and renders Glassmorphic UI components instantly.             |
|  - HTML5 Canvas displays frames with color-coded warning bounding box overlays,       |
|    properly scaled to match aspect ratios.                                            |
+---------------------------------------------------------------------------------------+
```

---

## 📡 Signal Mapping Strategy

RVO exposes a fixed enum of signal slots (`Dummy`, `MotionLevel`, `FacePresent`, `PersonDetected`). To model exam proctoring infractions, we map our AI detections to these types:

| Infraction Case | AI Detection Criteria | RVO Signal mapped | Signal Value | Event Duration |
|---|---|---|---|---|
| **Mobile Phone Present** | YOLOv8 detects a phone (`COCO class 67`) | `PersonDetected` | `1` (infraction) | 1,000 ms |
| **No Phone Present** | YOLOv8 detects no phone | `PersonDetected` | `0` (normal) | - |
| **Face Anomaly (0 / >1)** | Haar Cascades face count $\neq 1$ | `FacePresent` | `1` (infraction) | 1,000 ms |
| **Normal Student Presence**| Haar Cascades face count $= 1$ | `FacePresent` | `0` (normal) | - |

### Trigger Rule
In [rvo-remote.yaml](../rvo-deployment/config/rvo-remote.yaml), both signals are configured to trigger a `DummyEvent` once the infraction value remains $\ge 1$ continuously for **1,000 milliseconds**. 

---

## ⚡ The Decoupled Inference Pattern

Model inference is slow (e.g. YOLOv8 on CPU can take 150-250ms per frame). If RVO ran inference directly in the scheduler tick, the tick loop would stall.

To prevent this:
1. The scheduler tick's `execute()` writes the latest camera frame to a **single-slot mailbox** and returns the latest cached gRPC results instantly.
2. An independent worker thread retrieves the frame from the mailbox, encodes it, calls the gRPC `Detect()` method, and updates the cache.
3. If gRPC fails or times out, the cache expires via TTL, and the rest of the RVO scheduler continues to tick at 1 ms without head-of-line (HOL) blocking.
4. Heavy analysis is further offloaded to the asynchronous `clip_worker.py` daemon, removing blocking operations from the HTTP API server.
