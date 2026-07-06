import pytest
import os
import json
import clip_worker

def test_analyze_clip_zero_frames(mocker, temp_db):
    """Test that a clip with 0 frames is handled gracefully."""
    # Mock filesystem
    mocker.patch('os.path.exists', return_value=True)
    mocker.patch('builtins.open', mocker.mock_open(read_data=json.dumps({
        "frames_total": 0,
        "event_ts_ns": 1000
    })))
    mocker.patch('os.path.getmtime', return_value=1.0)
    mocker.patch('os.listdir', return_value=[])
    # Mock the model to prevent torch from crashing due to mocked open()
    mocker.patch('clip_worker.get_yolo_model')
    
    # Mock image reader to ensure it's not called
    mock_imread = mocker.patch('cv2.imread')
    
    clip_worker.analyze_clip("/tmp/mock/PhoneDetectedEvent_123")
    
    mock_imread.assert_not_called()
    
    # Verify incident was saved with empty detections
    import database
    incidents = database.get_all_incidents()
    assert len(incidents) == 1
    inc = database.get_incident_by_id("PhoneDetectedEvent_123")
    assert inc["violation"] == {
        "schema_version": 2,
        "category": "Mobile Phone Violation",
        "severity": "HIGH",
        "detections": {},
        "phone_count": 0,
        "face_anomaly_count": 0,
        "face_absent_count": 0,
        "face_multi_count": 0
    }

def test_watchdog_error_handling(mocker, capsys):
    """Bug #15 fix: Test that exceptions in analyze_clip don't kill watchdog."""
    # Mock analyze_clip to throw an exception
    mocker.patch('clip_worker.analyze_clip', side_effect=Exception("Simulated Crash"))
    mocker.patch('time.sleep', return_value=None)
    
    handler = clip_worker.ClipHandler()
    class MockEvent:
        is_directory = False
        src_path = "/tmp/mock/meta.json"
        
    # This should not raise an exception
    handler.on_created(MockEvent())
    
    # Verify the error was logged
    captured = capsys.readouterr()
    assert "[Worker] ERROR analyzing clip" in captured.out
    assert "Simulated Crash" in captured.out

def test_analyze_clip_processing(mocker, temp_db):
    """Test full processing of a clip."""
    mocker.patch('os.path.exists', return_value=True)
    mocker.patch('builtins.open', mocker.mock_open(read_data=json.dumps({
        "frames_total": 1,
        "event_ts_ns": 1000
    })))
    mocker.patch('os.path.getmtime', return_value=1.0)
    
    # Mock image loading
    mocker.patch('cv2.imread', return_value="dummy_image")
    
    # Mock YOLO model
    class MockBoxList:
        def __init__(self, boxes):
            self.boxes = boxes
            
    class MockBox:
        def __init__(self, cls_val, conf_val, xyxy):
            self.cls = cls_val
            self.conf = conf_val
            
            class MockTensor:
                def __init__(self, lst):
                    self.lst = lst
                def tolist(self):
                    return self.lst
            
            self.xyxy = [MockTensor(xyxy[0])]
            
    mock_model = mocker.Mock()
    mock_model.return_value = [MockBoxList(boxes=[
        MockBox(cls_val=[67], conf_val=[0.9], xyxy=[[10, 10, 100, 100]]) # Phone
    ])]
    
    mocker.patch('clip_worker.get_yolo_model', return_value=mock_model)
    mocker.patch('clip_worker.detect_person_count', return_value=1)
    
    clip_worker.analyze_clip("/tmp/mock/PhoneDetectedEvent_123")
    
    import database
    inc = database.get_incident_by_id("PhoneDetectedEvent_123")
    assert inc is not None
    assert "0" in inc["violation"]["detections"]
    assert inc["violation"]["detections"]["0"][0]["class"] == "phone"
    assert inc["violation"]["detections"]["0"][0]["conf"] == 0.9
