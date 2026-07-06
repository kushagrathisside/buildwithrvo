import sqlite3
import os
import json

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'incidents.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        # Enable WAL mode for concurrent read/write safety (Bug: SQLite BUSY)
        cursor.execute('PRAGMA journal_mode=WAL')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                timestamp_sec REAL,
                timestamp_ns INTEGER,
                category TEXT,
                severity TEXT,
                frames_total INTEGER,
                encode_ms INTEGER,
                violation_meta TEXT
            )
        ''')
        conn.commit()
    finally:
        conn.close()

def insert_incident(incident_data):
    """
    Inserts a newly processed incident into the SQLite database.
    incident_data should be a dict matching the schema.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO incidents 
            (id, timestamp_sec, timestamp_ns, category, severity, frames_total, encode_ms, violation_meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            incident_data['id'],
            incident_data['timestamp_sec'],
            incident_data.get('timestamp_ns', 0),
            incident_data['category'],
            incident_data['severity'],
            incident_data['frames_total'],
            incident_data.get('encode_ms', 0),
            json.dumps(incident_data['violation_meta'])
        ))
        conn.commit()
    finally:
        conn.close()

def get_all_incidents():
    """
    Returns all incidents sorted by timestamp descending.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM incidents ORDER BY timestamp_sec DESC LIMIT 100')
        rows = cursor.fetchall()
    finally:
        conn.close()
    
    incidents = []
    for r in rows:
        incidents.append({
            "id": r["id"],
            "timestamp_sec": r["timestamp_sec"],
            "timestamp_ns": r["timestamp_ns"],
            "category": r["category"],
            "severity": r["severity"],
            "frames_total": r["frames_total"],
            "encode_ms": r["encode_ms"],
        })
    return incidents

def get_incident_by_id(incident_id):
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM incidents WHERE id = ?', (incident_id,))
        row = cursor.fetchone()
    finally:
        conn.close()
    
    if not row:
        return None
    
    # Safe JSON parsing with fallback (Bug: crash on invalid JSON)
    try:
        violation = json.loads(row["violation_meta"]) if row["violation_meta"] else {}
    except (json.JSONDecodeError, TypeError):
        violation = {}
        
    return {
        "meta": {
            "event_ts_ns": row["timestamp_ns"],
            "frames_total": row["frames_total"],
            "encode_ms": row["encode_ms"]
        },
        "violation": violation,
        "timestamp_sec": row["timestamp_sec"]
    }

def clear_all_incidents():
    """
    Clears all incidents from the database.
    Called when switching video sources to prevent stale data (Bug #9).
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM incidents')
        conn.commit()
    finally:
        conn.close()
