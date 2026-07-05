import os
import json
import httpx
import cv2
import numpy as np
import time
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from ultralytics import YOLO
import socket

app = FastAPI(title="RVO Proctoring Dashboard Backend")

# Enable CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Schema version for violation_meta.json — bump when classification logic changes
# Any cached file without this version will be re-analyzed automatically
SCHEMA_VERSION = 2

# All live incident clips are written to clips/demo by rvo-remote.yaml
# We also scan the parent clips/ for pre-existing historical clips
CLIPS_DIRS = [
    os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment/clips/demo")),
    os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment/clips")),
]

# Lazy load the models to keep startup fast
_model = None
_face_cascade = None

def get_yolo_model():
    global _model
    if _model is None:
        model_path = os.path.abspath(os.path.join(BASE_DIR, "../ai-service/yolov8n.pt"))
        if os.path.exists(model_path):
            _model = YOLO(model_path)
        else:
            _model = YOLO("yolov8n.pt")
    return _model

def extract_frames(video_name):
    """
    Extracts an MP4 into a sequence of JPEGs so the Rust OpenCV engine
    can read it even if the host OS lacks video codecs (CAP_FFMPEG).
    """
    video_path = os.path.join(BASE_DIR, "../samplevideos", video_name)
    frames_dir = os.path.join(BASE_DIR, "../samplevideos", video_name.replace('.mp4', '_frames'))
    
    if os.path.exists(frames_dir) and len(os.listdir(frames_dir)) > 0:
        return frames_dir
        
    os.makedirs(frames_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    count = 1
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imwrite(os.path.join(frames_dir, f"frame_{count:04d}.jpg"), frame)
        count += 1
    cap.release()
    return frames_dir

def get_face_cascade():
    global _face_cascade
    if _face_cascade is None:
        _face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    return _face_cascade

def analyze_and_cache_clip(clip_path):
    """
    Scans a clip directory and performs YOLOv8/Cascade detections for all frames.
    Saves the results in violation_meta.json to cache them.
    If the cached file has an older schema_version it is invalidated and re-run.
    """
    meta_path = os.path.join(clip_path, "meta.json")
    vmeta_path = os.path.join(clip_path, "violation_meta.json")

    # Load cache — but only if schema version matches current version
    if os.path.exists(vmeta_path):
        try:
            with open(vmeta_path, "r") as f:
                cached = json.load(f)
            if cached.get("schema_version") == SCHEMA_VERSION:
                return cached
            # Schema mismatch — fall through to re-analyze
        except Exception:
            pass

    frames_total = 0
    # Read meta.json for frame count AND original event_type (primary classifier)
    event_type_from_meta = None
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
                frames_total = meta.get("frames_total", 0)
                event_type_from_meta = meta.get("event_type")
        except Exception:
            pass

    if not frames_total:
        frames_total = len([f for f in os.listdir(clip_path) if f.startswith("frame_") and f.endswith(".jpg")])

    yolo = get_yolo_model()
    face_cascade = get_face_cascade()
    
    detections_by_frame = {}
    phone_infractions = 0
    face_infractions = 0
    
    face_absent_count = 0     # frames where face_count == 0
    face_multi_count = 0      # frames where face_count > 1
    
    for i in range(frames_total):
        frame_file = os.path.join(clip_path, f"frame_{i:04d}.jpg")
        if not os.path.exists(frame_file):
            continue
            
        img = cv2.imread(frame_file)
        if img is None:
            continue
            
        frame_detections = []
        
        # 1. Phone Detection (YOLO)
        results = yolo(img, classes=[67], verbose=False)
        for box in results[0].boxes:
            xyxy = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            frame_detections.append({
                "class": "phone",
                "bbox": [int(x) for x in xyxy],
                "conf": round(conf, 2)
            })
            phone_infractions += 1
            
        # 2. Face Detection (Haar Cascades)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 4)
        
        for (x, y, w, h) in faces:
            frame_detections.append({
                "class": "face",
                "bbox": [int(x), int(y), int(x + w), int(y + h)],
                "conf": 1.0
            })

        n_faces = len(faces)
        if n_faces == 0:
            face_absent_count += 1
        elif n_faces > 1:
            face_multi_count += 1

        if frame_detections:
            detections_by_frame[str(i)] = frame_detections

    # Compute total face infraction frames after the loop (not inside it)
    face_infractions = face_absent_count + face_multi_count

    # --- Primary classification: use event_type from meta.json (most reliable) ---
    # Then folder name prefix, then fall back to re-inference counts
    EVENT_TYPE_MAP = {
        "PhoneDetectedEvent": ("Mobile Phone Violation", "HIGH"),
        "FaceAbsentEvent":    ("Face Absent — Student Left Frame", "HIGH"),
        "MultiFaceEvent":     ("Multiple Faces — Proxy / Impersonation", "HIGH"),
    }

    folder_name = os.path.basename(clip_path)

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
    
    try:
        with open(vmeta_path, "w") as f:
            json.dump(vmeta, f, indent=2)
    except Exception as e:
        print(f"Failed to write cache: {e}")
        
    return vmeta



@app.get("/api/status")
async def get_status():
    # 1. Check AI service on port 50051
    ai_online = False
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.2)
    try:
        s.connect(("127.0.0.1", 50051))
        ai_online = True
    except Exception:
        pass
    finally:
        s.close()

    # 2. Check RVO Prometheus port 9090
    rvo_online = False
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.2)
    try:
        s.connect(("127.0.0.1", 9090))
        rvo_online = True
    except Exception:
        pass
    finally:
        s.close()
        
    return {
        "rvo_online": rvo_online,
        "ai_service_online": ai_online
    }

@app.post("/api/set-source")
async def set_source(payload: dict):
    source = payload.get("source")
    if not source:
        raise HTTPException(status_code=400, detail="Missing 'source' parameter")
        
    config_path = os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment/config/rvo-remote.yaml"))
    
    try:
        with open(config_path, "r") as f:
            content = f.read()
            
        import re
        if source == "webcam":
            new_cam = "camera:\n  device_index: 0"
        else:
            # We assume source is either "hideandpeep.mp4" or "phoneandclear.mp4"
            # Extract frames via Python cv2 (which has bundled FFMPEG) to bypass Rust OS codec issues
            frames_dir = extract_frames(source)
            new_cam = f"camera:\n  source_uri: \"{frames_dir}/frame_%04d.jpg\""
            
        content = re.sub(r'camera:[\s\n]+(?:device_index:[^\n]+|source_uri:[^\n]+)', new_cam, content)
        
        with open(config_path, "w") as f:
            f.write(content)
            
        import subprocess
        # 1. Kill existing rvo-bin
        subprocess.run(["pkill", "-9", "-f", "rvo-bin"])
        
        # 2. Wait a tiny bit for port 9090 to free up
        time.sleep(0.5)
        
        # 3. Spawn a new rvo-bin in the background
        rvo_cwd = os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment"))
        subprocess.Popen(
            ["./rvo-bin", "--config", "config/rvo-remote.yaml"],
            cwd=rvo_cwd,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        
        return {"status": "success", "message": f"RVO engine restarted with source: {source}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/incidents")
async def list_incidents():
    incidents = []
    
    # Scan both directories
    for clips_dir in CLIPS_DIRS:
        if not os.path.exists(clips_dir):
            continue
            
        subdirs = [d for d in os.listdir(clips_dir) if os.path.isdir(os.path.join(clips_dir, d))]
        for d in subdirs:
            if d == "demo":
                continue
                
            path = os.path.join(clips_dir, d)
            meta_path = os.path.join(path, "meta.json")
            
            meta = {}
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as f:
                        meta = json.load(f)
                except Exception:
                    pass
                    
            # Run analysis in thread pool to avoid blocking the async event loop
            vmeta = await run_in_threadpool(analyze_and_cache_clip, path)
            
            incidents.append({
                "id": d,
                "timestamp_ns": meta.get("event_ts_ns", 0),
                "timestamp_sec": os.path.getmtime(path),
                "frames_total": meta.get("frames_total", 0),
                "encode_ms": meta.get("encode_ms", 0),
                "category": vmeta.get("category"),
                "severity": vmeta.get("severity")
            })
            
    # Sort incidents by ID descending (newer first)
    incidents.sort(key=lambda x: x["id"], reverse=True)
    return incidents

@app.get("/api/incidents/{incident_id}")
async def get_incident(incident_id: str):
    path = None
    for clips_dir in CLIPS_DIRS:
        test_path = os.path.join(clips_dir, incident_id)
        if os.path.exists(test_path) and os.path.isdir(test_path):
            path = test_path
            break
            
    if not path:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    meta_path = os.path.join(path, "meta.json")
    
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
        except Exception:
            pass
            
    # Run analysis in thread pool to avoid blocking the async event loop
    vmeta = await run_in_threadpool(analyze_and_cache_clip, path)
    
    return {
        "meta": meta,
        "violation": vmeta,
        "timestamp_sec": os.path.getmtime(path)
    }

@app.get("/api/incidents/{incident_id}/frames/{frame_name}")
async def get_frame(incident_id: str, frame_name: str):
    # Path sanitization — prevent directory traversal attacks
    if ".." in incident_id or "/" in incident_id:
        raise HTTPException(status_code=400, detail="Invalid incident ID")
    if ".." in frame_name or "/" in frame_name:
        raise HTTPException(status_code=400, detail="Invalid frame name")
    if not frame_name.startswith("frame_") or not frame_name.endswith(".jpg"):
        raise HTTPException(status_code=400, detail="Invalid frame name format")
    path = None
    for clips_dir in CLIPS_DIRS:
        test_path = os.path.join(clips_dir, incident_id, frame_name)
        if os.path.exists(test_path):
            path = test_path
            break
            
    if not path:
        raise HTTPException(status_code=404, detail="Frame not found")
        
    return FileResponse(path)

@app.get("/api/metrics")
async def get_metrics():
    metrics_data = {
        "ticks": 0,
        "frame_drops": 0,
        "clip_drops": 0,
        "event_drops": 0,
        "events_emitted": 0,
        "detector_execs": 0,
        "detector_skips": 0,
        "detector_failures": 0
    }
    
    try:
        async with httpx.AsyncClient(trust_env=False) as client:
            resp = await client.get("http://127.0.0.1:9090/metrics", timeout=5.0)
            if resp.status_code == 200:
                lines = resp.text.split("\n")
                for line in lines:
                    if line.startswith("#") or not line.strip():
                        continue
                    parts = line.split(" ")
                    if len(parts) == 2:
                        name, val = parts[0], parts[1]
                        try:
                            val_f = float(val)
                            if name.startswith("rvo_scheduler_ticks"):
                                metrics_data["ticks"] = int(val_f)
                            elif name.startswith("rvo_frame_drops_total"):
                                metrics_data["frame_drops"] = int(val_f)
                            elif name.startswith("rvo_clip_drops_total"):
                                metrics_data["clip_drops"] = int(val_f)
                            elif name.startswith("rvo_event_drops_total"):
                                metrics_data["event_drops"] = int(val_f)
                            elif name.startswith("rvo_events_emitted_total"):
                                metrics_data["events_emitted"] = int(val_f)
                            elif name.startswith("rvo_detector_exec_total"):
                                metrics_data["detector_execs"] = int(val_f)
                            elif name.startswith("rvo_detector_skip_total"):
                                metrics_data["detector_skips"] = int(val_f)
                            elif name.startswith("rvo_detector_failure_total"):
                                metrics_data["detector_failures"] = int(val_f)
                        except ValueError:
                            pass
    except Exception:
        pass
        
    return metrics_data

# Serve Static UI
static_dir = os.path.join(BASE_DIR, "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # reload=False: prevents uvicorn from spawning an untracked child watcher process
    # that would outlive the parent and hold port 8000 open after shutdown
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
