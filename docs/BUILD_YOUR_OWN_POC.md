# Building Custom POCs with the RVO Framework

While this repository demonstrates an Online Exam Proctoring use-case, the **RVO (Realtime Video Orchestrator) Framework** is a generalized orchestration engine. By adhering to its architectural philosophy, developers can rapidly build custom computer vision Proofs of Concept (POCs) for retail analytics, security monitoring, manufacturing QA, or autonomous robotics.

This guide outlines the methodology for designing a custom POC and documents the major architectural decisions you should emulate to ensure high performance and low latency.

---

## 1. Defining the Target Signals

The RVO Engine operates strictly on a set of normalized boolean or scalar primitives known as **Signals**. It has no understanding of complex tensors or bounding boxes. Your first step is translating your specific domain problem into these signals.

### Step-by-Step Implementation:
1. **Choose your Model:** Select a model suited for your task (e.g., YOLOv8 for object detection, MediaPipe for pose estimation, or a custom classification model).
2. **Update the gRPC Service (`app_service.py`):** Modify the `Detect()` gRPC stub to run your model on the incoming JPEG frames.
3. **Map to Enums:** Map your model's output to one of RVO's available primitive slots:
   - `PersonDetected`
   - `FacePresent`
   - `MotionLevel`
   - `Dummy`

*Example:* If building a **Warehouse Safety Monitor**, you might run a Hardhat Detection model. If no hardhat is detected on a worker, you emit `PersonDetected: 1` (Violation). If a hardhat is detected, you emit `PersonDetected: 0` (Safe).

---

## 2. Configuring Temporal Smoothing

Computer vision inference is noisy. A worker might turn their head, momentarily obscuring their hardhat, which would cause the model to flag a false violation for a single frame.

**Design Decision #1: Temporal Low-Pass Filtering**
Rather than handling smoothing in your Python ML code, you should offload this to the RVO Engine's highly optimized Rust scheduler.

Modify `rvo-deployment/config/rvo-remote.yaml`:
```yaml
detectors:
  - name: "HardhatMonitor"
    type: "grpc"
    endpoint: "http://localhost:50051"
    signal_mapping:
      - from: "PersonDetected"
        threshold: 1.0          # The value that constitutes an infraction
        duration_ms: 1500       # Must be sustained for 1.5 seconds consecutively
        trigger_event: "DummyEvent"
```
By setting `duration_ms: 1500`, RVO will suppress the event unless the ML model returns a violation consecutively for 1.5 seconds.

---

## 3. The Asynchronous Worker Pattern

When RVO triggers an event, it flushes a buffer of raw video frames to the disk (e.g., `clips/demo/FaceAbsentEvent_12345/`). 

**Design Decision #2: Decoupled AI Verification**
You should never parse or run heavy AI verification logic synchronously inside your web server (FastAPI/Django) when the user requests data. This blocks the HTTP event loop and cripples API performance.

Instead, create a dedicated background worker (`clip_worker.py`) using `watchdog`. 
1. The worker listens for new folders created by RVO.
2. It processes the raw frames offline, applying high-confidence batch-inference.
3. It normalizes the results into a structured JSON schema.
4. It inserts the final metrics into a relational Database (SQLite/PostgreSQL).

---

## 4. Frontend Reactivity

Once your backend Database is populated, you need to display the insights to the end-user.

**Design Decision #3: Server-Sent Events (SSE) over HTTP Polling**
Do not use `setInterval` or standard HTTP polling in your React/Vue frontend to check for new incidents. Polling aggressively consumes server resources and introduces latency.

Instead, use **Server-Sent Events (SSE)**.
1. Create a streaming endpoint in FastAPI that yields an async generator hooked into a Redis pub/sub channel or database trigger.
2. In your React frontend, use the native `EventSource` API to listen for push updates.
3. This guarantees that the millisecond your `clip_worker` commits a new incident to the Database, the frontend UI re-renders instantly without ever asking the server for updates.

---

## Summary of Major Design Decisions

When building your custom POC, adhere to these fundamental principles:

1. **Decouple Ingestion from Inference:** Never block the camera reading loop while waiting for a PyTorch/TensorFlow graph to execute. Use an asynchronous mailbox pattern (like RVO's gRPC implementation).
2. **Memoize Tensor Execution:** If multiple logical rules evaluate the same camera frame, cache the tensor outputs keyed by `frame_id` to avoid running the same neural network twice.
3. **Persist Relationally:** Do not use the file system as a database. Extract metadata from files asynchronously and insert it into a structured SQL database for fast querying.
4. **Push, Don't Pull:** Use WebSockets or SSE to push data to the client, ensuring a reactive, premium User Experience (UX).
