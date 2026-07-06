import React, { useState, useEffect, useRef } from 'react';
import './index.css';

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
        let displayTime = new Date(incident.timestamp_sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const severityClass = incident.severity ? incident.severity.toLowerCase() : 'low';
        const isSelected = selectedIncident && selectedIncident.id === incident.id;

        return (
          <div 
            key={incident.id} 
            className={`incident-item ${isSelected ? 'active' : ''}`}
            onClick={() => onSelect(incident)}
          >
            <div className="incident-header">
              <span className="incident-id">{incident.id}</span>
              <span className={`severity-badge ${severityClass}`}>{incident.severity || 'LOW'}</span>
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

const PlaybackViewer = ({ selectedIncident, isPlaying, setIsPlaying }) => {
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [incidentData, setIncidentData] = useState(null);
  const canvasRef = useRef(null);
  const playIntervalRef = useRef(null);

  useEffect(() => {
    if (!selectedIncident) {
      setIncidentData(null);
      setCurrentFrameIdx(0);
      return;
    }

    // Fetch full incident details (for violation meta)
    fetch(`http://localhost:8000/api/incidents/${selectedIncident.id}`)
      .then(res => res.json())
      .then(data => {
        setIncidentData(data);
        setCurrentFrameIdx(0);
        setIsPlaying(true);
      })
      .catch(console.error);
  }, [selectedIncident, setIsPlaying]);

  useEffect(() => {
    if (isPlaying && incidentData && incidentData.meta.frames_total > 0) {
      playIntervalRef.current = setInterval(() => {
        setCurrentFrameIdx(prev => (prev + 1) % incidentData.meta.frames_total);
      }, 100);
    } else {
      clearInterval(playIntervalRef.current);
    }

    return () => clearInterval(playIntervalRef.current);
  }, [isPlaying, incidentData]);

  useEffect(() => {
    if (!incidentData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    const frameName = `frame_${currentFrameIdx.toString().padStart(4, '0')}.jpg`;
    img.src = `http://localhost:8000/api/incidents/${selectedIncident.id}/frames/${frameName}`;
    
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Draw detections
      if (incidentData.violation && incidentData.violation.detections && incidentData.violation.detections[currentFrameIdx.toString()]) {
        const dets = incidentData.violation.detections[currentFrameIdx.toString()];
        dets.forEach(det => {
          const [x1, y1, x2, y2] = det.bbox;
          
          if (det.class === 'phone') {
            ctx.strokeStyle = '#ef4444'; // red
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
          } else if (det.class === 'face') {
            ctx.strokeStyle = '#3b82f6'; // blue
            ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          } else {
            ctx.strokeStyle = '#10b981'; // green
            ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
          }
          
          ctx.lineWidth = 3;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = '16px Inter, sans-serif';
          ctx.fillText(`${det.class} ${Math.round(det.conf * 100)}%`, x1, y1 - 5);
        });
      }
    };
  }, [currentFrameIdx, incidentData, selectedIncident]);

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value);
    setCurrentFrameIdx(val);
    setIsPlaying(false);
  };

  const totalFrames = incidentData?.meta?.frames_total || 0;
  const isReady = !!selectedIncident;

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

const DetailsPanel = ({ selectedIncident }) => {
  const [incidentData, setIncidentData] = useState(null);

  useEffect(() => {
    if (!selectedIncident) {
      setIncidentData(null);
      return;
    }

    fetch(`http://localhost:8000/api/incidents/${selectedIncident.id}`)
      .then(res => res.json())
      .then(setIncidentData)
      .catch(console.error);
  }, [selectedIncident]);

  return (
    <section className="details-panel card">
      <div className="section-header">
        <h2><i className="fa-solid fa-magnifying-glass-chart"></i> Diagnostic Insights</h2>
      </div>
      
      <div className="details-content" id="details-content">
        {!selectedIncident ? (
          <div className="placeholder-text">
            <p>Select an incident to view deep classification, severity metrics, and edge encoding latency.</p>
          </div>
        ) : !incidentData ? (
          <div className="placeholder-text"><p>Loading details...</p></div>
        ) : (
          <div>
            <div className="detail-row">
              <span className="detail-label">Classification</span>
              <span className="detail-value">{incidentData.violation?.category || 'Unknown'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Confidence</span>
              <span className="detail-value">{(incidentData.meta?.confidence * 100).toFixed(1)}%</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Edge Encoding Latency</span>
              <span className="detail-value">{incidentData.meta?.encode_ms} ms</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Total Duration</span>
              <span className="detail-value">{incidentData.meta?.frames_total} frames</span>
            </div>
            
            <h3 style={{ marginTop: '1.5rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', color: '#60a5fa' }}>Detections Summary</h3>
            <div className="detail-row">
              <span className="detail-label">Phones Detected</span>
              <span className="detail-value">{incidentData.violation?.phone_count || 0}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Face Missing Frames</span>
              <span className="detail-value">{incidentData.violation?.face_absent_count || 0}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Multi-Face Frames</span>
              <span className="detail-value">{incidentData.violation?.face_multi_count || 0}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

function App() {
  const [incidents, setIncidents] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoSource, setVideoSource] = useState('webcam');

  useEffect(() => {
    // Connect to Server-Sent Events
    const eventSource = new EventSource('http://localhost:8000/api/incidents/stream');
    
    eventSource.addEventListener('incidents_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setIncidents(data);
      } catch (err) {
        console.error("Failed to parse incidents update", err);
      }
    });

    eventSource.addEventListener('metrics_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setMetrics(data);
      } catch (err) {
        console.error("Failed to parse metrics update", err);
      }
    });

    return () => {
      eventSource.close();
    };
  }, []);

  const handleSourceChange = async (e) => {
    const src = e.target.value;
    setVideoSource(src);
    try {
      await fetch('http://localhost:8000/api/set-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src })
      });
      setSelectedIncident(null);
      setIncidents([]);
    } catch (err) {
      console.error("Failed to set source", err);
    }
  };

  const isOnline = metrics && metrics.ticks !== undefined;

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
            <p>Realtime Video Orchestration & Edge YOLOv8/Haar-Cascades</p>
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
                  <option value="hideandpeep.mp4">Sample: Hide & Peep</option>
                  <option value="phoneandclear.mp4">Sample: Phone & Clear</option>
                </select>
              </div>
              <div className="live-pulse">REAL-TIME</div>
            </div>
          </div>
          <div className="metrics-grid">
            <div className="metric-item">
              <span className="metric-value" id="metric-ticks">{metrics.ticks || '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-clock"></i> Scheduler Ticks</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-events">{metrics.events_emitted || '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-circle-exclamation text-red"></i> Events Emitted</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-frame-drops">{metrics.frame_drops || '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-triangle-exclamation text-orange"></i> Frame Drops</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-clip-drops">{metrics.clip_drops || '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-folder-minus text-orange"></i> Clip Drops</span>
            </div>
            <div className="metric-item">
              <span className="metric-value" id="metric-skips">{metrics.detector_execs || '-'}</span>
              <span className="metric-title"><i className="fa-solid fa-forward-step"></i> Detector Skips</span>
            </div>
          </div>
        </section>

        <section className="incidents-panel card">
          <div className="section-header">
            <h2><i className="fa-solid fa-list-check"></i> Flagged Infractions Feed</h2>
            <button id="btn-refresh" className="btn-icon" title="Refresh List"><i className="fa-solid fa-rotate"></i></button>
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

        <PlaybackViewer 
          selectedIncident={selectedIncident} 
          isPlaying={isPlaying} 
          setIsPlaying={setIsPlaying} 
        />

        <DetailsPanel selectedIncident={selectedIncident} />
      </main>

      <footer className="app-footer">
        <p>Built with <i className="fa-solid fa-heart text-red"></i> for the <b>Realtime Video Orchestration (RVO)</b> Engine Ecosystem</p>
      </footer>
    </>
  );
}

export default App;
