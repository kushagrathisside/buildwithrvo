import os
import time
import json
import cv2
import sys
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from ultralytics import YOLO

# Add poc-dashboard to path so we can import the database module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../poc-dashboard')))
import database

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIPS_DIR = os.path.abspath(os.path.join(BASE_DIR, '../rvo-deployment/clips/demo'))

SCHEMA_VERSION = 2

# Global ML Models
_model = None
_face_cascade = None

def get_yolo_model():
    global _model
    if _model is None:
        model_path = os.path.join(BASE_DIR, "yolov8n.pt")
        _model = YOLO(model_path if os.path.exists(model_path) else "yolov8n.pt")
    return _model

def detect_person_count(frame_bgr):
    yolo = get_yolo_model()
    results = yolo.predict(frame_bgr, conf=0.25, verbose=False)
    person_count = 0
    for r in results:
        for c in r.boxes.cls:
            if int(c) == 0:  # COCO class 0 is person
                person_count += 1
    return person_count

def analyze_clip(clip_path):
    print(f"[Worker] Analyzing clip: {clip_path}", flush=True)
    meta_path = os.path.join(clip_path, "meta.json")
    
    frames_total = 0
    event_type_from_meta = None
    meta_data = {}
    
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r") as f:
                meta_data = json.load(f)
                frames_total = meta_data.get("frames_total", 0)
                event_type_from_meta = meta_data.get("event_type")
        except Exception:
            pass

    if not frames_total:
        frames_total = len([f for f in os.listdir(clip_path) if f.startswith("frame_") and f.endswith(".jpg")])

    yolo = get_yolo_model()
    
    detections_by_frame = {}
    phone_infractions = 0
    face_absent_count = 0
    face_multi_count = 0
    
    for i in range(frames_total):
        frame_file = os.path.join(clip_path, f"frame_{i:04d}.jpg")
        if not os.path.exists(frame_file):
            continue
            
        img = cv2.imread(frame_file)
        if img is None:
            continue
            
        frame_detections = []
        
        # YOLO Phone Detection
        results = yolo(img, classes=[67], verbose=False)
        for box in results[0].boxes:
            xyxy = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            frame_detections.append({"class": "phone", "bbox": [int(x) for x in xyxy], "conf": round(conf, 2)})
            phone_infractions += 1
            
        n_faces = detect_person_count(img)
        if n_faces == 0:
            face_absent_count += 1
        elif n_faces > 1:
            face_multi_count += 1

        if frame_detections:
            detections_by_frame[str(i)] = frame_detections

    face_infractions = face_absent_count + face_multi_count
    folder_name = os.path.basename(clip_path)

    EVENT_TYPE_MAP = {
        "PhoneDetectedEvent": ("Mobile Phone Violation", "HIGH"),
        "FaceAbsentEvent":    ("Face Absent — Student Left Frame", "HIGH"),
        "MultiFaceEvent":     ("Multiple Faces — Proxy / Impersonation", "HIGH"),
    }

    if event_type_from_meta and event_type_from_meta in EVENT_TYPE_MAP:
        category, severity = EVENT_TYPE_MAP[event_type_from_meta]
    elif any(folder_name.startswith(k) for k in EVENT_TYPE_MAP):
        matched = next(k for k in EVENT_TYPE_MAP if folder_name.startswith(k))
        category, severity = EVENT_TYPE_MAP[matched]
    elif phone_infractions > 0 and phone_infractions >= face_infractions:
        category, severity = "Mobile Phone Violation", "HIGH"
    elif face_absent_count > face_multi_count:
        category, severity = "Face Absent — Student Left Frame", "HIGH"
    elif face_multi_count > 0:
        category, severity = "Multiple Faces — Proxy / Impersonation", "HIGH"
    elif face_infractions > 0:
        category, severity = "Face Anomaly (Absent / Multi-Face)", "MEDIUM"
    else:
        category, severity = "Unclassified Violation", "LOW"
        
    vmeta = {
        "schema_version": SCHEMA_VERSION,
        "category": category,
        "severity": severity,
        "detections": detections_by_frame,
        "phone_count": phone_infractions,
        "face_anomaly_count": face_infractions,
        "face_absent_count": face_absent_count,
        "face_multi_count": face_multi_count
    }
    
    incident_data = {
        "id": folder_name,
        "timestamp_sec": os.path.getmtime(clip_path),
        "timestamp_ns": meta_data.get("event_ts_ns", 0),
        "category": category,
        "severity": severity,
        "frames_total": frames_total,
        "encode_ms": meta_data.get("encode_ms", 0),
        "violation_meta": vmeta
    }
    
    # Save to SQLite
    database.insert_incident(incident_data)
    print(f"[Worker] Saved {folder_name} to database.", flush=True)
    
    # Write vmeta to disk as well just in case legacy frontend needs it temporarily
    try:
        with open(os.path.join(clip_path, "violation_meta.json"), "w") as f:
            json.dump(vmeta, f, indent=2)
    except Exception:
        pass


class ClipHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith("meta.json"):
            # RVO writes meta.json last, meaning the clip frames are fully written.
            clip_path = os.path.dirname(event.src_path)
            # Add a tiny delay to ensure disk buffers are flushed
            time.sleep(0.5)
            analyze_clip(clip_path)

def process_existing_clips():
    """Scan the directory on startup and process anything missing from DB."""
    if not os.path.exists(CLIPS_DIR):
        os.makedirs(CLIPS_DIR, exist_ok=True)
        
    existing_db_ids = {inc['id'] for inc in database.get_all_incidents()}
    
    for d in os.listdir(CLIPS_DIR):
        path = os.path.join(CLIPS_DIR, d)
        if os.path.isdir(path) and d not in existing_db_ids:
            # Check if meta.json exists (meaning RVO finished it)
            if os.path.exists(os.path.join(path, "meta.json")):
                analyze_clip(path)

if __name__ == "__main__":
    database.init_db()
    
    # Initialize models
    print("[Worker] Loading ML models...", flush=True)
    get_yolo_model()
    
    print(f"[Worker] Processing any backlog in {CLIPS_DIR}...", flush=True)
    process_existing_clips()
    
    print(f"[Worker] Starting watchdog on {CLIPS_DIR}...", flush=True)
    event_handler = ClipHandler()
    observer = Observer()
    observer.schedule(event_handler, CLIPS_DIR, recursive=True)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
