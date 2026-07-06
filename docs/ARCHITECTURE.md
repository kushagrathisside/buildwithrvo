# System Architecture and Signal Flow

This document outlines the internal data flow, state management, and signal mapping logic implemented within the RVO Proctoring Framework. The system is designed to provide ultra-low latency, deterministic execution while handling heavy, non-deterministic computer vision workloads.

---

## 1. Topological Data Flow

The framework orchestrates data across multiple process boundaries using gRPC for inference, SQLite for persistence, and Server-Sent Events (SSE) for frontend reactivity. The following diagram illustrates the complete lifecycle of a video frame from ingestion to UI rendering:

```text
+---------------------------------------------------------------------------------------+
|                                    RVO Core Engine                                    |
|  - Ingestion: Captures frames via V4L2 (webcam) or decodes HTTP/MP4 streams.          |
|  - Circular Buffer: Maintains a high-performance ring buffer holding the last N frames|
|    in memory to allow retrospective slicing when an event is triggered.               |
|  - Scheduler: Ticks at exactly 1 ms, evaluating internal FPS limits, managing locks,  |
|    and resolving signal dependencies without blocking.                                |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (Asynchronous Memory-Mapped Mailbox)
                                           v
+---------------------------------------------------------------------------------------+
|                         AI Inference Server (gRPC :50051)                             |
|  - Transport: Receives compressed JPEG byte payloads over a gRPC stream.              |
|  - Inference: Executes YOLOv8 (Ultralytics) for object detection and Haar Cascades    |
|    for facial boundary analysis.                                                      |
|  - LRU Caching: Implements a Least Recently Used (LRU) cache keyed by `frame_id`. If  |
|    multiple RVO policies query the same frame, the tensor operations are bypassed.    |
|  - Output: Yields a standardized `SignalOut` state (e.g., PersonDetected: 1).         |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (State Propagation)
                                           v
+---------------------------------------------------------------------------------------+
|                            RVO Event & Clip Manager                                   |
|  - Aggregation: Monitors incoming gRPC signal streams across all detectors.           |
|  - Temporal Smoothing: Applies a low-pass filter (e.g., signal must remain high for   |
|    1000 ms consecutively) to eliminate false positives like camera glitches.          |
|  - Clip Generation: Upon meeting the temporal threshold, locks the circular buffer,   |
|    extracts the relevant window of frames, and flushes them to disk with a metadata   |
|    manifest (I/O operation).                                                          |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (Inotify / Filesystem Event)
                                           v
+---------------------------------------------------------------------------------------+
|                            Async Daemon (clip_worker.py)                              |
|  - Watchdog: A daemon running `watchdog.observers` that detects new clip directories. |
|  - Deep Analysis: Traverses the flushed clip frames, running high-confidence batch    |
|    verification to ensure the initial real-time trigger was accurate.                 |
|  - Normalization: Transforms raw tensor outputs into a structured JSON schema.        |
|  - Persistence: Inserts the normalized incident into a relational SQLite Database.    |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (Relational Persistence)
                                           v
+---------------------------------------------------------------------------------------+
|                             FastAPI Gateway (:8000)                                   |
|  - Polling Engine: Asynchronously polls the SQLite database for unread incident rows. |
|  - SSE Tunnel: Establishes a uni-directional Server-Sent Events (SSE) tunnel to push  |
|    new incidents directly to connected clients, eliminating HTTP polling overhead.    |
|  - Telemetry: Proxies Prometheus metrics emitted by the RVO Engine to the frontend.   |
+---------------------------------------------------------------------------------------+
                                           |
                                           | (HTTP / SSE Push)
                                           v
+---------------------------------------------------------------------------------------+
|                             React Web Client (:5173)                                  |
|  - State Hydration: Consumes the SSE stream and updates the React state tree.         |
|  - Canvas Rendering: Translates normalized bounding box coordinates into dynamically    |
|    scaled HTML5 Canvas vector shapes, calculating the aspect ratio difference between |
|    the source video resolution and the responsive CSS viewport dimensions.            |
+---------------------------------------------------------------------------------------+
```

---

## 2. Signal Ontology and Normalization

The core RVO Engine operates on a generalized, abstract enumeration of event primitives: `Dummy`, `MotionLevel`, `FacePresent`, and `PersonDetected`. The engine has no concept of "Exam Proctoring"; it merely routes signals.

To specialize this engine for proctoring, a translation layer in the gRPC service maps highly specific computer vision outputs into these generalized constraints.

### 2.1 Mapping Table

| Proctoring Infraction Class | Computer Vision Mechanism | Target RVO Primitive | Emitted State | Temporal Persistence Threshold |
|---|---|---|---|---|
| **Mobile Device Violation** | YOLOv8 detects bounding box (`COCO class 67: cell phone`) | `PersonDetected` | `1` (Active) | 1,000 ms |
| **Normal Behavior (No Phone)** | YOLOv8 detects no target classes | `PersonDetected` | `0` (Idle) | - |
| **Face Anomaly (Absent)** | Haar Cascade detects 0 faces | `FacePresent` | `1` (Active) | 1,000 ms |
| **Face Anomaly (Multi)** | Haar Cascade detects >1 faces | `FacePresent` | `1` (Active) | 1,000 ms |
| **Normal Behavior (Single Face)** | Haar Cascade detects exactly 1 face | `FacePresent` | `0` (Idle) | - |

### 2.2 Temporal Constraints and Low-Pass Filtering
Computer vision is inherently noisy. A student shifting in their chair or briefly looking down can cause the Haar Cascade to drop a frame. If the engine reacted instantly, it would flood the database with micro-events.

To mitigate this, signals are passed through a temporal low-pass filter defined in the `rvo-remote.yaml` configuration matrix. An infraction event is only serialized to disk if the active state (`1`) is sustained continuously without returning to (`0`) for a minimum of **1,000 milliseconds**.

---

## 3. The Decoupled Caching Paradigm

Directly embedding deep learning inference (which can take 100ms - 300ms per frame on CPU) within the hot-path of a frame ingestion loop guarantees systemic instability. If the engine blocks to wait for inference, the camera buffer overflows, leading to dropped frames and severe latency.

To resolve this, the RVO Framework implements an **Asynchronous Isolation Pattern**:

### 3.1 Non-Blocking Execution
1. **The Scheduler Tick:** The RVO scheduler runs every 1 millisecond. When a frame is captured, it is placed in the circular buffer. The engine instantly requests the current state of all AI detectors.
2. **The Mailbox Protocol:** Instead of waiting for the AI to process the current frame, the engine writes the frame to a single-slot asynchronous mailbox and immediately reads the *last known inference state* from its local cache. The tick completes in under 1ms.
3. **Dedicated Workers:** An independent background thread within RVO continuously drains the memory slot, JPEG-compresses the frame, and invokes the `Detect()` gRPC stub over the network.
4. **Cache Updates:** When the gRPC response eventually returns (e.g., 200ms later), the background thread updates the local cache. The next 1ms scheduler tick will instantly read this updated state.

### 3.2 Memoization and Deduplication
In the `app_service.py` gRPC server, multiple logical detectors (e.g., one for phones, one for faces) might query the server simultaneously for the exact same frame. 

To prevent running YOLOv8 multiple times on the same data, the gRPC service implements memoization using the unique `frame_id`:
* A `_inference_cache` dictionary stores the output of the tensor graph keyed by `frame_id`.
* The dictionary is guarded by a `threading.Lock()` to ensure thread safety across concurrent gRPC requests.
* A short Time-To-Live (TTL) automatically evicts stale frames to prevent memory leaks.

### 3.3 Graceful Degradation
If the gRPC link is severed, or if the host machine experiences a massive CPU spike causing inference to time out, the local cache naturally expires via TTL. The RVO scheduler continues to tick at 1 ms, seamlessly dropping inference capabilities without halting hardware camera ingestion. Once the AI service recovers, the system automatically self-heals and resumes tracking.
