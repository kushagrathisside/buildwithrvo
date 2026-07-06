import pytest
import os
import json
import asyncio
from httpx import AsyncClient

# Test basic endpoints
def test_status(client):
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert "rvo_online" in data
    assert "ai_service_online" in data

def test_get_incidents(client, temp_db):
    import database
    database.insert_incident({
        "id": "Test_1",
        "timestamp_sec": 1.0,
        "category": "Cat",
        "severity": "LOW",
        "frames_total": 1,
        "violation_meta": {}
    })
    
    response = client.get("/api/incidents")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["id"] == "Test_1"

def test_get_incident_by_id(client, temp_db):
    import database
    database.insert_incident({
        "id": "Test_1",
        "timestamp_sec": 1.0,
        "category": "Cat",
        "severity": "LOW",
        "frames_total": 1,
        "violation_meta": {"phone_count": 1}
    })
    
    response = client.get("/api/incidents/Test_1")
    assert response.status_code == 200
    assert response.json()["violation"] == {"phone_count": 1}

def test_get_incident_404(client):
    response = client.get("/api/incidents/Missing")
    assert response.status_code == 404

# Test Path Traversal Security
def test_get_frame_path_traversal(client):
    # Attempt to traverse via incident ID using url encoding so client doesn't resolve it
    response = client.get("/api/incidents/..%2Fetc%2Fpasswd/frames/frame_0001.jpg")
    assert response.status_code in [400, 404]
    
    # Attempt to traverse via frame name
    response = client.get("/api/incidents/valid_id/frames/..%2Fsecret.txt")
    assert response.status_code in [400, 404]
    
    # Invalid frame prefix
    response = client.get("/api/incidents/valid_id/frames/image_0001.png")
    assert response.status_code in [400, 404]

# Test Source Switching Validations
def test_set_source_empty(client):
    response = client.post("/api/set-source", json={})
    assert response.status_code == 400
    assert "Missing 'source' parameter" in response.text

def test_set_source_invalid(client):
    # Bug #15 fix test
    response = client.post("/api/set-source", json={"source": "../../etc/passwd"})
    assert response.status_code == 400
    assert "Invalid source" in response.text

def test_set_source_valid(client, mocker, temp_db):
    # Mock extract_frames and subprocess to avoid actual side effects
    import server
    mocker.patch('server.extract_frames', return_value='/tmp/mock_frames')
    mocker.patch('subprocess.run')
    mocker.patch('subprocess.Popen')
    mocker.patch('asyncio.sleep', return_value=None)
    
    # Mock open for rvo_remote.yaml reading/writing
    mocked_file = mocker.mock_open(read_data="camera:\n  source_uri: old")
    mocker.patch('builtins.open', mocked_file)
    
    response = client.post("/api/set-source", json={"source": "hideandpeep.mp4"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    
    # Verify DB was cleared
    import database
    assert len(database.get_all_incidents()) == 0
    
    # Verify open was called to write the updated config and the log file
    assert mocked_file.call_count >= 3
