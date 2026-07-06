import React, { useState, useEffect, useRef, Component } from 'react';
import './index.css';

// ── Error Boundary (Bug #11) ──────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#ff3860' }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block' }}></i>
          <h2>Something went wrong</h2>
          <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>{this.state.error?.message}</p>
          <button 
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: 'white', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Incident Feed ─────────────────────────────────────────────────────────
// Bug #1: incident-item → incident-card
// Bug #2: incident-header → incident-card-header
// Bug #3: severity lowercase → keep UPPERCASE for CSS matching
const IncidentFeed = ({ incidents, selectedIncident, onSelect }) => {
  if (incidents.length === 0) {
    return (
      <div className="empty-state">
        <i className="fa-solid fa-eye-slash"></i>
        <p>No incidents detected yet. Monitoring active feeds...</p>
      </div>
    );
  }

  return (
    <>
      {incidents.map((incident) => {
        const ts = incident.timestamp_sec;
        const displayTime = ts
          ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '--:--:--';
        // Bug #3: Keep severity UPPERCASE so CSS `.severity-badge.HIGH` matches
        const severityClass = incident.severity || 'LOW';
        const isSelected = selectedIncident && selectedIncident.id === incident.id;

        return (
          <div 
            key={incident.id} 
            className={`incident-card ${isSelected ? 'active' : ''}`}
            onClick={() => onSelect(incident)}
          >
            <div className="incident-card-header">
              <span className="incident-id">{incident.id}</span>
              <span className={`severity-badge ${severityClass}`}>{severityClass}</span>
            </div>
            <div className="incident-title">{incident.category || 'Anomaly Detected'}</div>
            <div className="incident-meta">
              <span><i className="fa-solid fa-clock"></i> {displayTime}</span>
              <span><i className="fa-solid fa-film"></i> {incident.frames_total} frames</span>
            </div>
          </div>
        );
      })}
    </>
  );
};

// ── Playback Viewer ───────────────────────────────────────────────────────
// Bug #12: Share incidentData via prop instead of duplicate fetch
const PlaybackViewer = ({ selectedIncident, isPlaying, setIsPlaying, incidentData }) => {
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const canvasRef = useRef(null);
  const playIntervalRef = useRef(null);

  // Reset frame index when incident changes
  useEffect(() => {
    setCurrentFrameIdx(0);
    if (incidentData) {
      setIsPlaying(true);
    }
  }, [selectedIncident, incidentData, setIsPlaying]);

  // Play/pause interval
  useEffect(() => {
    const framesTotal = incidentData?.meta?.frames_total || 0;
    if (isPlaying && framesTotal > 0) {
      playIntervalRef.current = setInterval(() => {
        setCurrentFrameIdx(prev => (prev + 1) % framesTotal);
      }, 100);
    } else {
      clearInterval(playIntervalRef.current);
    }

    return () => clearInterval(playIntervalRef.current);
  }, [isPlaying, incidentData]);

  // Canvas rendering + bounding boxes
  useEffect(() => {
    if (!incidentData || !canvasRef.current || !selectedIncident) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    const frameName = `frame_${currentFrameIdx.toString().padStart(4, '0')}.jpg`;
    img.src = `http://localhost:8000/api/incidents/${selectedIncident.id}/frames/${frameName}`;
    
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const scaleX = canvas.width / img.width;
      const scaleY = canvas.height / img.height;

      // Draw bounding box detections
      const dets = incidentData.violation?.detections?.[currentFrameIdx.toString()];
      if (dets && Array.isArray(dets)) {
        dets.forEach(det => {
          if (!det.bbox || det.bbox.length < 4) return;
          const x1 = det.bbox[0] * scaleX;
          const y1 = det.bbox[1] * scaleY;
          const x2 = det.bbox[2] * scaleX;
          const y2 = det.bbox[3] * scaleY;
          
          if (det.class === 'phone') {
            ctx.strokeStyle = '#ef4444';
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
          } else if (det.class === 'face') {
            ctx.strokeStyle = '#3b82f6';
            ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          } else {
            ctx.strokeStyle = '#10b981';
            ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
          }
          
          ctx.lineWidth = 3;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '16px Inter, sans-serif';
          ctx.fillText(`${det.class} ${Math.round((det.conf || 0) * 100)}%`, x1, y1 - 5);
        });
      }
    };

    // Bug #9 partial: graceful handling if frame image fails
    img.onerror = () => {
      // just leave canvas as-is, don't crash
    };
  }, [currentFrameIdx, incidentData, selectedIncident]);

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value);
    setCurrentFrameIdx(val);
    setIsPlaying(false);
  };

  const totalFrames = incidentData?.meta?.frames_total || 0;
  const isReady = !!selectedIncident && !!incidentData;

  return (
    <section className="playback-panel card">
      <div className="section-header">
        <h2><i className="fa-solid fa-tv"></i> Precision Evidence Playback</h2>
        <div id="active-incident-title" className="active-title">{selectedIncident ? selectedIncident.id : 'No Incident Selected'}</div>
      </div>

      <div className="video-container">
        <canvas id="video-canvas" ref={canvasRef} width="640" height="480"></canvas>
        {!isReady && (
          <div className="video-overlay" id="video-overlay" style={{ display: 'flex' }}>
            <div className="overlay-content">
              <i className="fa-solid fa-play-circle large-play"></i>
              <p>Select an incident folder from the infractions log to start review</p>
            </div>
          </div>
        )}
      </div>

      <div className="playback-controls">
        <button id="btn-play-pause" className="btn-control" disabled={!isReady} onClick={() => setIsPlaying(!isPlaying)}>
          <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
        </button>
        <div className="time-slider-container">
          <input 
            type="range" 
            id="time-slider" 
            min="0" 
            max={totalFrames > 0 ? totalFrames - 1 : 0} 
            value={currentFrameIdx} 
            onChange={handleSliderChange}
            disabled={!isReady}
          />
          <div className="frame-label">
            <span id="lbl-frame-current">{currentFrameIdx}</span> / <span id="lbl-frame-total">{totalFrames > 0 ? totalFrames - 1 : 0}</span> frames
          </div>
        </div>
        <button id="btn-prev" className="btn-control" disabled={!isReady} onClick={() => { setIsPlaying(false); setCurrentFrameIdx(Math.max(0, currentFrameIdx - 1)); }}>
          <i className="fa-solid fa-step-backward"></i>
        </button>
        <button id="btn-next" className="btn-control" disabled={!isReady} onClick={() => { setIsPlaying(false); setCurrentFrameIdx(Math.min(totalFrames > 0 ? totalFrames - 1 : 0, currentFrameIdx + 1)); }}>
          <i className="fa-solid fa-step-forward"></i>
        </button>
      </div>
    </section>
  );
};

// ── Diagnostic Insights Panel ─────────────────────────────────────────────
// Bug #5: confidence → compute from violation data instead of phantom field
// Bug #8: detail-row → stat-row, detail-label → stat-label, detail-value → stat-value
// Bug #12: Share incidentData via prop instead of duplicate fetch
const DetailsPanel = ({ incidentData }) => {
  // Bug #5: Compute average confidence from detections instead of phantom meta.confidence
  const computeConfidence = (data) => {
    if (!data?.violation?.detections) return null;
    const allConfs = [];
    Object.values(data.violation.detections).forEach(frameDets => {
      if (Array.isArray(frameDets)) {
        frameDets.forEach(det => {
          if (typeof det.conf === 'number') allConfs.push(det.conf);
        });
      }
    });
    if (allConfs.length === 0) return null;
    return allConfs.reduce((a, b) => a + b, 0) / allConfs.length;
  };

  const avgConf = incidentData ? computeConfidence(incidentData) : null;

  return (
    <section className="details-panel card">
      <div className="section-header">
        <h2><i className="fa-solid fa-magnifying-glass-chart"></i> Diagnostic Insights</h2>
      </div>
      
      <div className="details-content" id="details-content">
        {!incidentData ? (
          <div className="placeholder-text">
            <p>Select an incident to view deep classification, severity metrics, and edge encoding latency.</p>
          </div>
        ) : (
          <div>
            <div className="insight-block">
              <h3>Classification</h3>
              <div className="insight-val">
                <i className="fa-solid fa-tag text-blue"></i>
                {incidentData.violation?.category || 'Unknown'}
              </div>
            </div>

            <div className="insight-block">
              <h3>Detection Metrics</h3>
              <div className="stat-row">
                <span className="stat-label">Avg. Confidence</span>
                <span className="stat-value">{avgConf !== null ? `${(avgConf * 100).toFixed(1)}%` : 'N/A'}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Edge Encoding</span>
                <span className="stat-value">{incidentData.meta?.encode_ms ?? '—'} ms</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Total Frames</span>
                <span className="stat-value">{incidentData.meta?.frames_total ?? '—'}</span>
              </div>
            </div>

            <div className="insight-block">
              <h3>Detections Summary</h3>
              <div className="stat-row">
                <span className="stat-label"><i className="fa-solid fa-mobile-screen text-red"></i> Phones Detected</span>
                <span className="stat-value">{incidentData.violation?.phone_count || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label"><i className="fa-solid fa-user-slash text-orange"></i> Face Missing</span>
                <span className="stat-value">{incidentData.violation?.face_absent_count || 0}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label"><i className="fa-solid fa-users text-orange"></i> Multi-Face</span>
                <span className="stat-value">{incidentData.violation?.face_multi_count || 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────
function App() {
  const [incidents, setIncidents] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedIncidentData, setSelectedIncidentData] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoSource, setVideoSource] = useState('webcam');
  const [sseConnected, setSseConnected] = useState(false);

  // SSE connection with onerror handler (Bug #13)
  useEffect(() => {
    const eventSource = new EventSource('http://localhost:8000/api/incidents/stream');
    
    eventSource.addEventListener('incidents_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setIncidents(data);
        setSseConnected(true);
      } catch (err) {
        console.error("Failed to parse incidents update", err);
      }
    });

    eventSource.addEventListener('metrics_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMetrics(data);
        setSseConnected(true);
      } catch (err) {
        console.error("Failed to parse metrics update", err);
      }
    });

    // Bug #13: Handle SSE errors
    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Bug #12: Single fetch for incident data, shared between PlaybackViewer + DetailsPanel
  useEffect(() => {
    if (!selectedIncident) {
      setSelectedIncidentData(null);
      return;
    }

    fetch(`http://localhost:8000/api/incidents/${selectedIncident.id}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setSelectedIncidentData(data);
      })
      .catch(err => {
        console.error("Failed to fetch incident details", err);
        setSelectedIncidentData(null);
      });
  }, [selectedIncident]);

  const handleSourceChange = async (e) => {
    const src = e.target.value;
    const previousSource = videoSource;
    setVideoSource(src);
    try {
      const resp = await fetch('http://localhost:8000/api/set-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setSelectedIncident(null);
      setSelectedIncidentData(null);
      setIncidents([]);
    } catch (err) {
      console.error("Failed to set source", err);
      // Rollback on failure (Bug #9 from TC-1.9)
      setVideoSource(previousSource);
    }
  };

  // Bug #10: Wire refresh button
  const handleRefresh = async () => {
    try {
      const resp = await fetch('http://localhost:8000/api/incidents');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setIncidents(data);
    } catch (err) {
      console.error("Failed to refresh incidents", err);
    }
  };

  const isOnline = sseConnected && metrics && metrics.ticks !== undefined;

  return (
    <>
      <div className="glass-bg"></div>
      <div className="glow glow-1"></div>
      <div className="glow glow-2"></div>
      
      <header className="app-header">
        <div className="header-logo">
          <span className="logo-icon"><i className="fa-solid fa-shield-halved"></i></span>
          <div className="logo-text">
            <h1>RVO AI Proctoring Node</h1>
            <p>Realtime Video Orchestration &amp; Edge YOLOv8</p>
          </div>
        </div>
        
        <div className="health-badges">
          <div id="badge-rvo" className={`health-badge ${isOnline ? 'online' : 'offline'}`}>
            <span className="indicator"></span>
            <span className="badge-label"><i className="fa-solid fa-server"></i> RVO Engine: <b id="rvo-status-text">{isOnline ? 'ONLINE' : 'OFFLINE'}</b></span>
          </div>
          <div id="badge-ai" className={`health-badge ${isOnline ? 'online' : 'offline'}`}>
            <span className="indicator"></span>
            <span className="badge-label"><i className="fa-solid fa-brain"></i> AI gRPC Service: <b id="ai-status-text">{isOnline ? 'ONLINE' : 'OFFLINE'}</b></span>
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="metrics-bar card">
          <div className="section-header">
            <h2><i className="fa-solid fa-chart-line"></i> RVO Engine Live Statistics</h2>
            <div className="header-controls">
              <div className="source-selector">
                <label htmlFor="camera-source"><i className="fa-solid fa-video"></i> Input Source:</label>
                <select id="camera-source" className="styled-select" value={videoSource} onChange={handleSourceChange}>
                  <option value="webcam">Live Webcam</option>
                  <option value="hideandpeep.mp4">Sample: Hide &amp; Peep</option>
                  <option value="phoneandclear.mp4">Sample: Phone &amp; Clear</option>
                </select>
              </div>
              <div className="live-pulse">REAL-TIME</div>
            </div>
          </div>
          <div className="metrics-grid">
            <div className="metric-item">
              <span className="metric-value" id="metric-ticks">{metrics.ticks ?? '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-clock"></i> Scheduler Ticks</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-events">{metrics.events_emitted ?? '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-circle-exclamation text-red"></i> Events Emitted</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-frame-drops">{metrics.frame_drops ?? '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-triangle-exclamation text-orange"></i> Frame Drops</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-clip-drops">{metrics.clip_drops ?? '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-folder-minus text-orange"></i> Clip Drops</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-skips">{metrics.detector_execs ?? '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-forward-step"></i> Detector Execs</span>
            </div>
          </div>
        </section>

        <section className="incidents-panel card">
          <div className="section-header">
            <h2><i className="fa-solid fa-list-check"></i> Flagged Infractions Feed</h2>
            <button id="btn-refresh" className="btn-icon" title="Refresh List" onClick={handleRefresh}><i className="fa-solid fa-rotate"></i></button>
          </div>
          
          <div className="incidents-list-container">
            <div id="incidents-list" className="incidents-list">
              <IncidentFeed 
                incidents={incidents} 
                selectedIncident={selectedIncident} 
                onSelect={setSelectedIncident} 
              />
            </div>
          </div>
        </section>

        <ErrorBoundary>
          <PlaybackViewer 
            selectedIncident={selectedIncident} 
            isPlaying={isPlaying} 
            setIsPlaying={setIsPlaying}
            incidentData={selectedIncidentData}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <DetailsPanel incidentData={selectedIncidentData} />
        </ErrorBoundary>
      </main>

      <footer className="app-footer">
        <p>Built with <i className="fa-solid fa-heart text-red"></i> for the <b>Realtime Video Orchestration (RVO)</b> Engine Ecosystem</p>
      </footer>
    </>
  );
}

export default App;
