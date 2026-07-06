import pytest
import sqlite3
import json
import database

def test_init_db(temp_db):
    """Test that init_db creates the table and schema correctly."""
    conn = sqlite3.connect(temp_db)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='incidents';")
    table = cursor.fetchone()
    assert table is not None
    
    # Check journal mode is WAL
    cursor.execute("PRAGMA journal_mode;")
    mode = cursor.fetchone()[0]
    assert mode.lower() == "wal"
    conn.close()

def test_insert_and_get_incident(temp_db):
    """Test inserting and retrieving an incident."""
    dummy_incident = {
        "id": "TestEvent_123",
        "timestamp_sec": 1600000000.0,
        "timestamp_ns": 1600000000123456000,
        "category": "Mobile Phone Violation",
        "severity": "HIGH",
        "frames_total": 50,
        "encode_ms": 120,
        "violation_meta": {"test": "data"}
    }
    
    database.insert_incident(dummy_incident)
    
    incidents = database.get_all_incidents()
    assert len(incidents) == 1
    assert incidents[0]["id"] == "TestEvent_123"
    assert incidents[0]["severity"] == "HIGH"

def test_get_incident_by_id(temp_db):
    """Test fetching full incident by ID with JSON parsing."""
    dummy_incident = {
        "id": "TestEvent_123",
        "timestamp_sec": 1600000000.0,
        "timestamp_ns": 1600000000123456000,
        "category": "Mobile Phone Violation",
        "severity": "HIGH",
        "frames_total": 50,
        "encode_ms": 120,
        "violation_meta": {"test": "data"}
    }
    database.insert_incident(dummy_incident)
    
    inc = database.get_incident_by_id("TestEvent_123")
    assert inc is not None
    assert inc["timestamp_sec"] == 1600000000.0
    assert inc["meta"]["frames_total"] == 50
    assert inc["meta"]["encode_ms"] == 120
    assert inc["violation"] == {"test": "data"}

def test_get_incident_invalid_json(temp_db):
    """Test safe JSON parsing when DB contains invalid JSON."""
    conn = sqlite3.connect(temp_db)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO incidents (id, timestamp_sec, timestamp_ns, category, severity, frames_total, encode_ms, violation_meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', ("BadJSONEvent", 1.0, 1000, "Cat", "LOW", 10, 10, "{bad json"))
    conn.commit()
    conn.close()
    
    inc = database.get_incident_by_id("BadJSONEvent")
    assert inc is not None
    assert inc["violation"] == {}  # Should fallback to empty dict

def test_clear_all_incidents(temp_db):
    """Test clearing all incidents (used on source switch)."""
    dummy_incident = {
        "id": "TestEvent_123",
        "timestamp_sec": 1600000000.0,
        "timestamp_ns": 1600000000123456000,
        "category": "Mobile Phone Violation",
        "severity": "HIGH",
        "frames_total": 50,
        "encode_ms": 120,
        "violation_meta": {}
    }
    database.insert_incident(dummy_incident)
    assert len(database.get_all_incidents()) == 1
    
    database.clear_all_incidents()
    assert len(database.get_all_incidents()) == 0
