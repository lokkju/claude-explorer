"""Tests for the config endpoint."""


def test_get_config(client):
    """Test GET /api/config returns app configuration without conversation_count.

    The count was removed from this endpoint (2026-05-06) — it lived on
    `/api/config/stats` to keep `/api/config` cheap; keeping a hardcoded
    0 here was misleading to anyone curling the endpoint directly.
    """
    response = client.get("/api/config")

    assert response.status_code == 200

    data = response.json()
    assert "data_dir" in data
    assert "conversation_count" not in data


def test_config_data_dir_is_path(client):
    """Test that data_dir is a valid path string."""
    response = client.get("/api/config")

    assert response.status_code == 200

    data = response.json()
    # Should be a non-empty string
    assert isinstance(data["data_dir"], str)
    assert len(data["data_dir"]) > 0


def test_get_config_stats_includes_count(client):
    """`/api/config/stats` carries `conversation_count`."""
    response = client.get("/api/config/stats")

    assert response.status_code == 200

    data = response.json()
    assert "data_dir" in data
    assert "conversation_count" in data
    assert isinstance(data["conversation_count"], int)
