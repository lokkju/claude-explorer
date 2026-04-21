"""Tests for the config endpoint."""


def test_get_config(client):
    """Test GET /api/config returns app configuration."""
    response = client.get("/api/config")

    assert response.status_code == 200

    data = response.json()
    assert "data_dir" in data
    assert "conversation_count" in data
    assert isinstance(data["conversation_count"], int)


def test_config_data_dir_is_path(client):
    """Test that data_dir is a valid path string."""
    response = client.get("/api/config")

    assert response.status_code == 200

    data = response.json()
    # Should be a non-empty string
    assert isinstance(data["data_dir"], str)
    assert len(data["data_dir"]) > 0
