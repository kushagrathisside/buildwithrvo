# POC Architecture & Signal Flow

This document details the end-to-end data flow and signal mapping logic implemented in the proctoring POC.

---

## 🔄 End-to-End Data Flow

```text
+---------------------------------------------------------------------------------------+
|                                  Dashboard Backend                                    |
|  Serves an MJPEG HTTP stream at :8000/api/video_feed from a sample MP4 video.         |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (HTTP / OpenCV VideoCapture)
                                           v
+---------------------------------------------------------------------------------------+
|                                   RVO Core Engine                                     |
|  - Ingests frames and pushes to a circular buffer (capacity 300 / ~10 seconds).       |
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
|  - Signal Store updates with 1-second TTL.                                            |
|  - Event Engine checks rules: sustained signal for 1000 ms triggers an infraction.    |
|  - Clip Manager locks buffer, slices the window, writes frames + meta.json to disk.   |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (File system write)
                                           v
+---------------------------------------------------------------------------------------+
|                                Streamlit / Web Client                                 |
|  - Lists incidents; classifies and caches bounding boxes on first load.               |
|  - HTML5 Canvas displays frames with color-coded warning bounding box overlays.      |
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
In [rvo-remote.yaml](file:///home/pro2024001/buildwithrvo/rvo-deployment/config/rvo-remote.yaml), both signals are configured to trigger a `DummyEvent` once the infraction value remains $\ge 1$ continuously for **1,000 milliseconds**. 

---

## ⚡ The Decoupled Inference Pattern

Model inference is slow (e.g. YOLOv8 on CPU can take 150-250ms per frame). If RVO ran inference directly in the scheduler tick, the tick loop would stall.

To prevent this:
1. The scheduler tick's `execute()` writes the latest camera frame to a **single-slot mailbox** and returns the latest cached gRPC results instantly.
2. An independent worker thread retrieves the frame from the mailbox, encodes it, calls the gRPC `Detect()` method, and updates the cache.
3. If gRPC fails or times out, the cache expires via TTL, and the rest of the RVO scheduler continues to tick at 1 ms without head-of-line (HOL) blocking.
