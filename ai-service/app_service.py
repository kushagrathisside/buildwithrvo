import grpc
from concurrent import futures
import time
import threading
import cv2
import numpy as np
import sys
import os

# Import compiled proto files
import detector_pb2
import detector_pb2_grpc
from ultralytics import YOLO

# Load an ultra-fast edge model
model = YOLO(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'yolov8n.pt'))

# Load YOLOv8 model for both phone and person detection
yolo_model = YOLO(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'yolov8n.pt'))

def detect_person_count(frame_bgr):
    """
    Detects if a person is in the frame using YOLO (proxy for face)
    """
    results = yolo_model.predict(frame_bgr, conf=0.25, verbose=False)
    person_count = 0
    for r in results:
        for c in r.boxes.cls:
            if int(c) == 0:  # COCO class 0 is person
                person_count += 1
    return person_count

# Per-frame inference result cache — avoids re-running YOLO+Haar when multiple
# detectors send the same frame_id within a short window (3 detectors × same frame).
# Thread-safe: guarded by _cache_lock. TTL = 3 seconds.
_inference_cache = {}   # frame_id -> (timestamp, result_dict)
_cache_lock = threading.Lock()
_CACHE_TTL_SEC = 3.0

def _get_cached_result(frame_id):
    with _cache_lock:
        entry = _inference_cache.get(frame_id)
        if entry and (time.monotonic() - entry[0]) < _CACHE_TTL_SEC:
            return entry[1]
        return None

def _set_cached_result(frame_id, result):
    with _cache_lock:
        _inference_cache[frame_id] = (time.monotonic(), result)
        # Evict entries older than TTL to prevent unbounded growth
        now = time.monotonic()
        stale = [k for k, v in _inference_cache.items() if now - v[0] >= _CACHE_TTL_SEC]
        for k in stale:
            del _inference_cache[k]

class ProctorDetector(detector_pb2_grpc.DetectorServicer):
    def Detect(self, request, context):
        try:
            # Check inference cache first — avoid triple YOLO+Haar for same frame
            cached = _get_cached_result(request.frame_id)
            if cached is not None:
                resp = detector_pb2.DetectResponse()
                resp.signals.extend(cached)
                return resp

            # Convert incoming RVO raw bytes directly to an image frame
            nparr = np.frombuffer(request.frame_jpeg, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                return detector_pb2.DetectResponse()
                
            # Run YOLO inference focusing purely on 'cell phone' (COCO class 67)
            results = model(img, classes=[67], verbose=False)
            phone_detected = len(results[0].boxes) > 0
            
            # Face counting with YOLOv8 person detection
            face_count = detect_person_count(img)

            # Map to RVO signal types:
            # - PhoneDetected: 1 if a phone is visible in the frame
            # - FaceAbsent:    1 if NO face is detected (student left seat / covered camera)
            # - MultiFacePresent: 1 if MORE than 1 face is detected (impersonation / proxy)
            phone_val = 1 if phone_detected else 0
            face_absent_val = 1 if face_count == 0 else 0
            multi_face_val = 1 if face_count > 1 else 0

            sub = "absent" if face_count == 0 else ("multi" if face_count > 1 else "ok")
            print(f"[gRPC Detect] frame_id={request.frame_id} | phone={phone_val} | face_count={face_count} ({sub})", flush=True)

            signals = [
                detector_pb2.SignalOut(signal_type="PhoneDetected",    value=phone_val,       ttl_ns=1_000_000_000),
                detector_pb2.SignalOut(signal_type="FaceAbsent",       value=face_absent_val, ttl_ns=1_000_000_000),
                detector_pb2.SignalOut(signal_type="MultiFacePresent", value=multi_face_val,  ttl_ns=1_000_000_000),
            ]

            # Store in cache so the other 2 detector calls skip inference
            _set_cached_result(request.frame_id, signals)

            resp = detector_pb2.DetectResponse()
            resp.signals.extend(signals)
            return resp

        except Exception as e:
            print(f"[gRPC Error] Exception during Detect: {e}", file=sys.stderr, flush=True)
            return detector_pb2.DetectResponse()

def serve():
    # Increased to 8 workers: two detectors at max_fps=8 each = 16 concurrent calls/sec
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    detector_pb2_grpc.add_DetectorServicer_to_server(ProctorDetector(), server)
    server.add_insecure_port('[::]:50051')
    print("🚀 Proctoring AI Service listening on port 50051...", flush=True)
    server.start()
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        server.stop(0)

if __name__ == '__main__':
    serve()
