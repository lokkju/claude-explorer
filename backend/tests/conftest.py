"""Pytest configuration and fixtures."""

import pytest
from fastapi.testclient import TestClient
from pathlib import Path
import tempfile
import json

from backend.main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def temp_data_dir():
    """Create a temporary directory with sample conversation data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = Path(tmpdir)

        # Create sample conversation file
        sample_conv = {
            "uuid": "test-uuid-123",
            "name": "Test Conversation",
            "summary": "A test conversation for unit testing",
            "model": "claude-sonnet-4-6",
            "created_at": "2024-03-01T12:00:00Z",
            "updated_at": "2024-03-01T13:00:00Z",
            "is_starred": False,
            "is_temporary": False,
            "current_leaf_message_uuid": "msg-2",
            "chat_messages": [
                {
                    "uuid": "msg-1",
                    "sender": "human",
                    "text": "Hello, Claude!",
                    "content": [{"type": "text", "text": "Hello, Claude!"}],
                    "created_at": "2024-03-01T12:00:00Z",
                    "updated_at": "2024-03-01T12:00:00Z",
                    "parent_message_uuid": None,
                },
                {
                    "uuid": "msg-2",
                    "sender": "assistant",
                    "text": "Hello! How can I help you today?",
                    "content": [{"type": "text", "text": "Hello! How can I help you today?"}],
                    "created_at": "2024-03-01T12:01:00Z",
                    "updated_at": "2024-03-01T12:01:00Z",
                    "parent_message_uuid": "msg-1",
                },
            ],
        }

        conv_file = data_dir / "test-uuid-123.json"
        with open(conv_file, "w") as f:
            json.dump(sample_conv, f)

        yield data_dir


@pytest.fixture
def sample_conversation():
    """Return sample conversation data."""
    return {
        "uuid": "test-uuid-123",
        "name": "Test Conversation",
        "summary": "A test conversation",
        "model": "claude-sonnet-4-6",
        "created_at": "2024-03-01T12:00:00Z",
        "updated_at": "2024-03-01T13:00:00Z",
        "is_starred": False,
        "is_temporary": False,
        "message_count": 2,
        "human_message_count": 1,
        "has_branches": False,
        "source": "CLAUDE_AI",
    }
