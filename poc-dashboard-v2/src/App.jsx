import React, { useState, useEffect, useRef } from 'react';
import './index.css';

const IncidentFeed = ({ incidents, selectedIncident, onSelect }) => {
  if (incidents.length === 0) {
    return (
      <div className="incident-feed" id="incidentFeed">
        <div className="empty-state">No incidents logged yet. Monitoring...</div>
      </div>
    );
  }

  return (
    <div className="incident-feed" id="incidentFeed">
      {incidents.map((incident) => {
        let displayTime = new Date(incident.timestamp_sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const severityClass = incident.severity ? incident.severity.toLowerCase() : 'low';
        const isSelected = selectedIncident && selectedIncident.id === incident.id;

        return (
          <div 
            key={incident.id} 
            className={`incident-card ${isSelected ? 'active' : ''}`}
            onClick={() => onSelect(incident)}
          >
            <div className="incident-header">
              <span className="incident-id">{incident.id}</span>
              <span className={`severity-badge ${severityClass}`}>{incident.severity || 'LOW'}</span>
            </div>
            <div className="incident-title">{incident.category || 'Anomaly Detected'}</div>
            <div className="incident-meta">
              <span><i className="fas fa-clock"></i> {displayTime}</span>
              <span><i className="fas fa-film"></i> {incident.frames_total} f</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const MetricsPanel = ({ metrics }) => {
  return (
    <div className="metrics-panel">
      <div className="metric-box">
        <div className="metric-value">{metrics.ticks || 0}</div>
        <div className="metric-label">Ticks</div>
      </div>
      <div className="metric-box">
        <div className="metric-value">{metrics.events_emitted || 0}</div>
        <div className="metric-label">Events</div>
      </div>
      <div className="metric-box">
        <div className="metric-value">{metrics.detector_execs || 0}</div>
        <div className="metric-label">AI Inference</div>
      </div>
      <div className="metric-box">
        <div className="metric-value">{metrics.frame_drops || 0}</div>
        <div className="metric-label">Drops</div>
      </div>
    </div>
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
      // Setup canvas dimensions based on image
      // Note: in a real app you might want to handle resizeObserver to make the canvas truly responsive
      // but for this POC we'll set the internal resolution to match the image
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      
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
          ctx.fillText(`${det.class} ${det.conf}`, x1, y1 - 5);
        });
      }
    };
  }, [currentFrameIdx, incidentData, selectedIncident]);

  if (!selectedIncident) {
    return (
      <div className="viewer-placeholder">
        <i className="fas fa-video fa-3x" style={{ opacity: 0.2, marginBottom: '1rem' }}></i>
        <p>Select an incident from the feed to view playback</p>
      </div>
    );
  }

  return (
    <div className="player-container">
      <div className="canvas-wrapper">
        <canvas ref={canvasRef} className="video-canvas"></canvas>
      </div>
      <div className="controls">
        <button className="control-btn" onClick={() => setIsPlaying(!isPlaying)}>
          <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
        </button>
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${(currentFrameIdx / Math.max(1, (incidentData?.meta?.frames_total || 1) - 1)) * 100}%` }}
          ></div>
        </div>
        <div className="time-display">
          {currentFrameIdx} / {(incidentData?.meta?.frames_total || 1) - 1} frames
        </div>
      </div>
    </div>
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
      // Optionally reset UI state here
      setSelectedIncident(null);
      setIncidents([]);
    } catch (err) {
      console.error("Failed to set source", err);
    }
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">RVO</div>
          <h1>Proctor V2</h1>
        </div>
        
        <div className="video-source-selector" style={{ padding: '0 1.5rem', marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '1px' }}>Camera Source</label>
          <select 
            value={videoSource} 
            onChange={handleSourceChange}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', outline: 'none' }}
          >
            <option value="webcam" style={{ color: 'black' }}>Live Webcam</option>
            <option value="hideandpeep.mp4" style={{ color: 'black' }}>Sample: Face Absent (hideandpeep.mp4)</option>
            <option value="phoneandclear.mp4" style={{ color: 'black' }}>Sample: Phone Detected (phoneandclear.mp4)</option>
          </select>
        </div>

        <div className="feed-header">
          <h2>Flagged Infractions</h2>
          <div className="status-indicator">
            <span className="pulse"></span> Live
          </div>
        </div>
        
        <IncidentFeed 
          incidents={incidents} 
          selectedIncident={selectedIncident} 
          onSelect={setSelectedIncident} 
        />
      </aside>
      
      <main className="main-content">
        <MetricsPanel metrics={metrics} />
        <div className="viewer-panel">
          <PlaybackViewer 
            selectedIncident={selectedIncident} 
            isPlaying={isPlaying} 
            setIsPlaying={setIsPlaying} 
          />
        </div>
      </main>
    </div>
  );
}

export default App;
