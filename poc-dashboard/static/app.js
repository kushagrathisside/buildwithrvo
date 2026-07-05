// State Variables
let currentIncident = null;
let isPlaying = false;
let currentFrameIndex = 0;
let totalFrames = 0;
let detections = {};
let playbackInterval = null;
const frameDurationMs = 60; // Playback speed (~16 fps)

// DOM Elements
const badgeRvo = document.getElementById("badge-rvo");
const badgeAi = document.getElementById("badge-ai");
const textRvoStatus = document.getElementById("rvo-status-text");
const textAiStatus = document.getElementById("ai-status-text");

const metricTicks = document.getElementById("metric-ticks");
const metricEvents = document.getElementById("metric-events");
const metricFrameDrops = document.getElementById("metric-frame-drops");
const metricClipDrops = document.getElementById("metric-clip-drops");
const metricSkips = document.getElementById("metric-skips");

// Camera Source Dropdown Logic
const cameraSource = document.getElementById('camera-source');
if (cameraSource) {
    cameraSource.addEventListener('change', async (e) => {
        const source = e.target.value;
        cameraSource.disabled = true; // prevent spamming
        
        try {
            const res = await fetch('http://localhost:8000/api/set-source', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source })
            });
            if (!res.ok) throw new Error('Failed to change source');
            console.log(`Source changed to ${source}`);
        } catch (err) {
            console.error(err);
            alert("Failed to change video source.");
        } finally {
            cameraSource.disabled = false;
        }
    });
}

const incidentsList = document.getElementById("incidents-list");
const btnRefresh = document.getElementById("btn-refresh");

const activeIncidentTitle = document.getElementById("active-incident-title");
const videoCanvas = document.getElementById("video-canvas");
const ctx = videoCanvas.getContext("2d");
const videoOverlay = document.getElementById("video-overlay");

const btnPlayPause = document.getElementById("btn-play-pause");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const timeSlider = document.getElementById("time-slider");
const lblFrameCurrent = document.getElementById("lbl-frame-current");
const lblFrameTotal = document.getElementById("lbl-frame-total");
const detailsContent = document.getElementById("details-content");

// Image Preloader Cache
const imageCache = {};

// Helper: Format Nanosecond timestamps into readable time
function formatNsTimestamp(ns) {
    if (!ns) return "N/A";
    const date = new Date(ns / 1000000);
    return date.toLocaleTimeString() + `.${String(ns % 1000000).substring(0, 3)}`;
}

// 1. Connection Status Checking
async function checkStatus() {
    try {
        const response = await fetch("/api/status");
        if (response.ok) {
            const data = await response.json();
            
            // Update RVO Badge
            if (data.rvo_online) {
                badgeRvo.className = "health-badge online";
                textRvoStatus.innerText = "RUNNING";
            } else {
                badgeRvo.className = "health-badge offline";
                textRvoStatus.innerText = "OFFLINE";
            }
            
            // Update AI Service Badge
            if (data.ai_service_online) {
                badgeAi.className = "health-badge online";
                textAiStatus.innerText = "ACTIVE";
            } else {
                badgeAi.className = "health-badge offline";
                textAiStatus.innerText = "OFFLINE";
            }
        }
    } catch (error) {
        badgeRvo.className = "health-badge offline";
        textRvoStatus.innerText = "OFFLINE";
        badgeAi.className = "health-badge offline";
        textAiStatus.innerText = "OFFLINE";
    }
}

// 2. Metrics Polling
async function pollMetrics() {
    try {
        const response = await fetch("/api/metrics");
        if (response.ok) {
            const data = await response.json();
            metricTicks.innerText = data.ticks.toLocaleString();
            metricEvents.innerText = data.events_emitted;
            metricFrameDrops.innerText = data.frame_drops;
            metricClipDrops.innerText = data.clip_drops;
            metricSkips.innerText = data.detector_skips;

            // Toggle alert colors — removes the class if condition no longer holds
            metricEvents.classList.toggle("text-red", data.events_emitted > 0);
            metricFrameDrops.classList.toggle("text-orange", data.frame_drops > 0);
            metricClipDrops.classList.toggle("text-orange", data.clip_drops > 0);
        }
    } catch (error) {
        console.error("Error polling metrics:", error);
    }
}

// Track rendered incident IDs to enable diff-render (avoid full DOM wipe)
let renderedIncidentIds = new Set();

// 3. Incidents Loading — diff-render to preserve scroll position and active selection
async function loadIncidents() {
    try {
        const response = await fetch("/api/incidents");
        if (response.ok) {
            const incidents = await response.json();

            if (incidents.length === 0) {
                if (renderedIncidentIds.size === 0) {
                    incidentsList.innerHTML = `
                        <div class="empty-state">
                            <i class="fa-solid fa-eye-slash"></i>
                            <p>No incidents detected yet. Monitoring active feeds...</p>
                        </div>`;
                }
                return;
            }

            // Remove the empty-state placeholder if incidents now exist
            const emptyState = incidentsList.querySelector(".empty-state");
            if (emptyState) emptyState.remove();

            // Only render NEW incidents — don't wipe existing DOM
            incidents.forEach(incident => {
                if (renderedIncidentIds.has(incident.id)) {
                    // Already rendered: just update the active class
                    const existing = incidentsList.querySelector(`.incident-card[data-id="${incident.id}"]`);
                    if (existing) {
                        existing.classList.toggle("active", !!(currentIncident && currentIncident.id === incident.id));
                    }
                    return;
                }

                renderedIncidentIds.add(incident.id);

                const card = document.createElement("div");
                card.className = `incident-card ${currentIncident && currentIncident.id === incident.id ? 'active' : ''}`;
                card.dataset.id = incident.id;

                // Use real-world filesystem timestamp from backend
                const timeString = incident.timestamp_sec
                    ? new Date(incident.timestamp_sec * 1000).toLocaleTimeString()
                    : "Unknown";

                card.innerHTML = `
                    <div class="incident-card-header">
                        <span class="incident-id">${incident.id}</span>
                        <span class="severity-badge ${incident.severity}">${incident.severity}</span>
                    </div>
                    <div class="incident-title">${incident.category}</div>
                    <div class="incident-meta">
                        <span><i class="fa-solid fa-clock"></i> ${timeString}</span>
                        <span><i class="fa-solid fa-images"></i> ${incident.frames_total} f</span>
                        <span><i class="fa-solid fa-microchip"></i> ${incident.encode_ms} ms</span>
                    </div>
                `;

                card.addEventListener("click", () => selectIncident(incident));
                // Prepend so newest incidents appear at the top
                incidentsList.prepend(card);
            });
        }
    } catch (error) {
        console.error("Error loading incidents:", error);
    }
}

// 4. Select Incident and Load Data
async function selectIncident(incident) {
    // UI selection visual reload
    document.querySelectorAll(".incident-card").forEach(c => c.classList.remove("active"));
    const selectedCard = document.querySelector(`.incident-card[data-id="${incident.id}"]`);
    if (selectedCard) selectedCard.classList.add("active");
    
    // Clear playback state
    stopPlayback();
    
    try {
        const response = await fetch(`/api/incidents/${incident.id}`);
        if (response.ok) {
            const data = await response.json();
            currentIncident = incident;
            totalFrames = data.meta.frames_total || data.meta.frames_written || 0;
            detections = data.violation.detections || {};
            currentFrameIndex = 0;
            
            // Prepare image cache
            Object.keys(imageCache).forEach(k => delete imageCache[k]);
            
            activeIncidentTitle.innerText = incident.id;
            videoOverlay.style.display = "none";
            
            // Enable controls
            btnPlayPause.disabled = false;
            btnPlayPause.innerHTML = `<i class="fa-solid fa-play"></i>`;
            btnPrev.disabled = false;
            btnNext.disabled = false;
            timeSlider.disabled = false;
            timeSlider.max = totalFrames - 1;
            timeSlider.value = 0;
            
            lblFrameCurrent.innerText = "1";
            lblFrameTotal.innerText = totalFrames;
            
            // Render Diagnostic Insights panel
            renderDiagnostics(data);
            
            // Load and draw the first frame
            drawFrame(0);
        }
    } catch (error) {
        console.error("Error fetching incident details:", error);
    }
}

function renderDiagnostics(data) {
    const timeString = data.timestamp_sec ? new Date(data.timestamp_sec * 1000).toLocaleString() : new Date().toLocaleString();
    detailsContent.innerHTML = `
        <div class="insight-block">
            <h3>Violation Class</h3>
            <div class="insight-val text-red">
                <i class="fa-solid fa-triangle-exclamation"></i> ${data.violation.category}
            </div>
        </div>
        
        <div class="insight-block">
            <h3>Telemetry Summary</h3>
            <div class="stat-row">
                <span class="stat-label">Event Timestamp</span>
                <span class="stat-value">${timeString}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Total Frames</span>
                <span class="stat-value">${totalFrames}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Edge Encoding latency</span>
                <span class="stat-value">${data.meta.encode_ms} ms</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Phone Anomaly Frames</span>
                <span class="stat-value text-red">${data.violation.phone_count}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Face Anomaly Frames</span>
                <span class="stat-value text-orange">${data.violation.face_anomaly_count}</span>
            </div>
        </div>
    `;
}

// 5. Draw Frame and Overlay Bounding Boxes on Canvas
function drawFrame(index) {
    if (!currentIncident) return;
    
    const frameName = `frame_${String(index).padStart(4, '0')}.jpg`;
    const frameUrl = `/api/incidents/${currentIncident.id}/frames/${frameName}`;
    
    // Check Cache first
    if (imageCache[index]) {
        renderImageOnCanvas(imageCache[index], index);
    } else {
        const img = new Image();
        img.onload = () => {
            imageCache[index] = img;
            if (currentFrameIndex === index) {
                renderImageOnCanvas(img, index);
            }
        };
        img.src = frameUrl;
    }
    
    // Update seek controls
    timeSlider.value = index;
    lblFrameCurrent.innerText = index + 1;
}

function renderImageOnCanvas(img, index) {
    // Sync canvas internal resolution to its actual displayed size
    // This prevents blurry frames when CSS shrinks the canvas element
    const rect = videoCanvas.getBoundingClientRect();
    if (videoCanvas.width !== Math.floor(rect.width) || videoCanvas.height !== Math.floor(rect.height)) {
        videoCanvas.width = Math.floor(rect.width);
        videoCanvas.height = Math.floor(rect.height);
    }

    // Clear canvas
    ctx.clearRect(0, 0, videoCanvas.width, videoCanvas.height);
    
    // Draw raw image frame
    ctx.drawImage(img, 0, 0, videoCanvas.width, videoCanvas.height);
    
    // Draw bounding boxes overlays
    const frameDetections = detections[String(index)];
    if (frameDetections && frameDetections.length > 0) {
        frameDetections.forEach(det => {
            const [x1, y1, x2, y2] = det.bbox;
            
            // Adjust box relative coordinates to fit 640x480 canvas size
            // Note: RVO writes standard camera frame sizes. Standard OpenCV is 640x480, but if it differs:
            const wScale = videoCanvas.width / img.naturalWidth;
            const hScale = videoCanvas.height / img.naturalHeight;
            
            const rx1 = x1 * wScale;
            const ry1 = y1 * hScale;
            const rw = (x2 - x1) * wScale;
            const rh = (y2 - y1) * hScale;
            
            if (det.class === "phone") {
                // Red Bounding Box for Mobile Phones
                ctx.strokeStyle = "#ff3860";
                ctx.fillStyle = "rgba(255, 56, 96, 0.15)";
                ctx.lineWidth = 3;
                ctx.strokeRect(rx1, ry1, rw, rh);
                ctx.fillRect(rx1, ry1, rw, rh);
                
                // Label tag
                ctx.fillStyle = "#ff3860";
                ctx.font = "bold 13px 'Space Grotesk', sans-serif";
                const labelText = `MOBILE PHONE (${Math.round(det.conf * 100)}%)`;
                const textWidth = ctx.measureText(labelText).width;
                ctx.fillRect(rx1 - 1, ry1 - 20, textWidth + 10, 20);
                
                ctx.fillStyle = "#ffffff";
                ctx.fillText(labelText, rx1 + 4, ry1 - 5);
            } else if (det.class === "face") {
                // Orange Bounding Box for Faces
                ctx.strokeStyle = "#ff9f43";
                ctx.fillStyle = "rgba(255, 159, 67, 0.1)";
                ctx.lineWidth = 2;
                ctx.strokeRect(rx1, ry1, rw, rh);
                ctx.fillRect(rx1, ry1, rw, rh);
                
                // Label tag
                ctx.fillStyle = "#ff9f43";
                ctx.font = "bold 11px 'Space Grotesk', sans-serif";
                const labelText = "PROCTOR FACE";
                const textWidth = ctx.measureText(labelText).width;
                ctx.fillRect(rx1 - 1, ry1 - 16, textWidth + 8, 16);
                
                ctx.fillStyle = "#0b0f19";
                ctx.fillText(labelText, rx1 + 3, ry1 - 4);
            }
        });
    }
}

// 6. Playback Control actions
function togglePlayback() {
    if (isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (!currentIncident) return;
    isPlaying = true;
    btnPlayPause.innerHTML = `<i class="fa-solid fa-pause"></i>`;
    
    playbackInterval = setInterval(() => {
        currentFrameIndex++;
        if (currentFrameIndex >= totalFrames) {
            // Loop back to start
            currentFrameIndex = 0;
        }
        drawFrame(currentFrameIndex);
    }, frameDurationMs);
}

function stopPlayback() {
    isPlaying = false;
    btnPlayPause.innerHTML = `<i class="fa-solid fa-play"></i>`;
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
}

// Next / Prev single frames
function stepNext() {
    stopPlayback();
    if (!currentIncident) return;
    currentFrameIndex = (currentFrameIndex + 1) % totalFrames;
    drawFrame(currentFrameIndex);
}

function stepPrev() {
    stopPlayback();
    if (!currentIncident) return;
    currentFrameIndex = (currentFrameIndex - 1 + totalFrames) % totalFrames;
    drawFrame(currentFrameIndex);
}

// Initialize setup
function init() {
    checkStatus();
    pollMetrics();
    loadIncidents();
    
    // Status intervals
    setInterval(checkStatus, 3000);
    setInterval(pollMetrics, 1000);
    setInterval(loadIncidents, 5000);
    
    // Event bindings
    btnPlayPause.addEventListener("click", togglePlayback);
    btnNext.addEventListener("click", stepNext);
    btnPrev.addEventListener("click", stepPrev);
    btnRefresh.addEventListener("click", () => {
        // Full reset: clear rendered state so all incidents re-render fresh
        renderedIncidentIds.clear();
        incidentsList.innerHTML = "";
        loadIncidents();
        checkStatus();
        pollMetrics();
    });
    
    timeSlider.addEventListener("input", (e) => {
        stopPlayback();
        currentFrameIndex = parseInt(e.target.value);
        drawFrame(currentFrameIndex);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
