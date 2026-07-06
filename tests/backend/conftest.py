import os
import sys
import tempfile
import pytest
from fastapi.testclient import TestClient

# Add project roots to sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, os.path.join(BASE_DIR, 'poc-dashboard'))
sys.path.insert(0, os.path.join(BASE_DIR, 'ai-service'))

import database

@pytest.fixture
def temp_db(monkeypatch):
    """Creates a temporary SQLite database for testing."""
    fd, temp_db_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    
    # Patch the database module to use our temporary DB
    monkeypatch.setattr(database, 'DB_PATH', temp_db_path)
    
    # Initialize the DB schema
    database.init_db()
    
    yield temp_db_path
    
    # Cleanup
    os.remove(temp_db_path)

@pytest.fixture
def client(temp_db):
    """Provides a TestClient for the FastAPI app with the temp DB."""
    # Import inside fixture to ensure monkeypatched DB_PATH is used when server module is loaded
    # Note: server.py in poc-dashboard is loaded via the sys.path
    import server
    with TestClient(server.app) as test_client:
        yield test_client
