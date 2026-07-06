import pytest
import sys
import os

# Ensure the grpc stubs are in path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(BASE_DIR, 'ai-service'))

import app_service
import detector_pb2
from detector_pb2 import DetectRequest, DetectResponse, SignalOut

def test_grpc_exception_handling(mocker):
    """Test that exceptions in the gRPC handler return an empty response instead of crashing."""
    mocker.patch('cv2.imdecode', return_value=None)  # Simulate bad JPEG
    
    detector = app_service.ProctorDetector()
    req = DetectRequest(frame_id=1, frame_jpeg=b"bad_data")
    
    # Should not raise an exception
    resp = detector.Detect(req, None)
    
    assert isinstance(resp, DetectResponse)
    assert len(resp.signals) == 0

def test_grpc_cache_behavior(mocker):
    """Test the inference cache to prevent redundant YOLO calls."""
    mock_model = mocker.Mock()
    
    class MockResult:
        def __init__(self):
            mock_box = mocker.Mock()
            mock_box.cls = [67] # Phone
            mock_box.conf = [0.9]
            self.boxes = [mock_box]
    
    mock_model.return_value = [MockResult()]
    mocker.patch('app_service.model', mock_model)
    mocker.patch('app_service.detect_person_count', return_value=1)
    
    # Mock valid image
    import numpy as np
    mocker.patch('cv2.imdecode', return_value=np.zeros((10,10,3), dtype=np.uint8))
    
    detector = app_service.ProctorDetector()
    req1 = DetectRequest(frame_id=100, frame_jpeg=b"valid")
    req2 = DetectRequest(frame_id=100, frame_jpeg=b"valid") # Duplicate frame_id
    
    resp1 = detector.Detect(req1, None)
    resp2 = detector.Detect(req2, None)
    
    assert len(resp1.signals) == 3
    assert len(resp2.signals) == 3
    
    # Model should only have been called ONCE due to cache
    mock_model.assert_called_once()
