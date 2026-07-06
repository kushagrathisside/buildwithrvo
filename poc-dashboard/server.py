import os
import json
import httpx
import asyncio
import re
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from sse_starlette.sse import EventSourceResponse
import socket

import database
database.init_db()
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

# ── Allowed sample video names (Bug #15: input validation) ─────────────────
ALLOWED_SOURCES = {"webcam", "hideandpeep.mp4", "phoneandclear.mp4"}

def extract_frames(video_name):
    """
    Extracts an MP4 into a sequence of JPEGs so the Rust OpenCV engine
    can read it even if the host OS lacks video codecs (CAP_FFMPEG).
    Bug #6 fix: Start frame numbering at 0 to match frontend indexing.
    """
    video_path = os.path.join(BASE_DIR, "../samplevideos", video_name)
    frames_dir = os.path.join(BASE_DIR, "../samplevideos", video_name.replace('.mp4', '_frames'))
    
    if os.path.exists(frames_dir) and len(os.listdir(frames_dir)) > 0:
        return frames_dir
        
    os.makedirs(frames_dir, exist_ok=True)
    import cv2
    cap = cv2.VideoCapture(video_path)
    count = 0  # Bug #6: Start at 0, not 1
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imwrite(os.path.join(frames_dir, f"frame_{count:04d}.jpg"), frame)
        count += 1
    cap.release()
    return frames_dir


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
    
    # Bug #15: Validate source against allowlist
    if source not in ALLOWED_SOURCES:
        raise HTTPException(status_code=400, detail=f"Invalid source: {source}")
        
    config_path = os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment/config/rvo-remote.yaml"))
    
    try:
        with open(config_path, "r") as f:
            content = f.read()
            
        if source == "webcam":
            new_cam = "camera:\n  device_index: 0"
        else:
            # Bug #7: Run extract_frames in threadpool to avoid blocking async event loop
            frames_dir = await run_in_threadpool(extract_frames, source)
            new_cam = f"camera:\n  source_uri: \"{frames_dir}/frame_%04d.jpg\""
            
        content = re.sub(r'camera:[\s\n]+(?:device_index:[^\n]+|source_uri:[^\n]+)', new_cam, content)
        
        with open(config_path, "w") as f:
            f.write(content)
        
        # Bug #9: Clear the incidents DB when switching sources
        database.clear_all_incidents()
        
        import subprocess
        # 1. Kill existing rvo-bin
        subprocess.run(["pkill", "-9", "-f", "rvo-bin"])
        
        # Bug #8: Use asyncio.sleep instead of blocking time.sleep
        await asyncio.sleep(0.5)
        
        # 3. Spawn a new rvo-bin in the background
        rvo_cwd = os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment"))
        # Bug #14: Properly manage the log file handle
        log_file = open(os.path.join(rvo_cwd, "rvo_bin.log"), "w")
        proc = subprocess.Popen(
            ["./rvo-bin", "--config", "config/rvo-remote.yaml"],
            cwd=rvo_cwd,
            start_new_session=True,
            stdout=log_file,
            stderr=log_file
        )
        # Close our copy of the file descriptor — the child process has its own
        log_file.close()
        
        return {"status": "success", "message": f"RVO engine restarted with source: {source}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/incidents")
async def list_incidents():
    return database.get_all_incidents()

@app.get("/api/incidents/stream")
async def stream_incidents(request: Request):
    """
    Server-Sent Events endpoint to stream incidents and metrics to the frontend
    without polling.
    """
    async def event_generator():
        last_id = None
        while True:
            if await request.is_disconnected():
                break
                
            # Fetch latest incidents from DB
            incidents = database.get_all_incidents()
            new_first_id = incidents[0]["id"] if incidents else None
            if new_first_id != last_id:
                last_id = new_first_id
                yield {
                    "event": "incidents_update",
                    "data": json.dumps(incidents)
                }
                
            # Fetch metrics (async fetch from Prometheus)
            try:
                metrics = await get_metrics()
                yield {
                    "event": "metrics_update",
                    "data": json.dumps(metrics)
                }
            except Exception:
                pass
                
            await asyncio.sleep(1)
            
    return EventSourceResponse(event_generator())

@app.get("/api/incidents/{incident_id}")
async def get_incident(incident_id: str):
    inc = database.get_incident_by_id(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc

@app.get("/api/incidents/{incident_id}/frames/{frame_name}")
async def get_frame(incident_id: str, frame_name: str):
    # Path sanitization — prevent directory traversal attacks
    if ".." in incident_id or "/" in incident_id:
        raise HTTPException(status_code=400, detail="Invalid incident ID")
    if ".." in frame_name or "/" in frame_name:
        raise HTTPException(status_code=400, detail="Invalid frame name")
    if not frame_name.startswith("frame_") or not frame_name.endswith(".jpg"):
        raise HTTPException(status_code=400, detail="Invalid frame name format")
    
    CLIPS_DIRS = [
        os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment/clips/demo")),
        os.path.abspath(os.path.join(BASE_DIR, "../rvo-deployment/clips")),
    ]
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
