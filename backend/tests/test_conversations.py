"""Tests for the conversations endpoints."""


def test_list_conversations(client):
    """Test GET /api/conversations returns a list."""
    response = client.get("/api/conversations")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_list_conversations_with_source_filter(client):
    """Test filtering by source."""
    # Test CLAUDE_AI filter
    response = client.get("/api/conversations", params={"source": "CLAUDE_AI"})
    assert response.status_code == 200

    # Test CLAUDE_CODE filter
    response = client.get("/api/conversations", params={"source": "CLAUDE_CODE"})
    assert response.status_code == 200


def test_list_conversations_with_sort(client):
    """Test sorting conversations."""
    # Sort by updated_at desc (default)
    response = client.get("/api/conversations", params={"sort": "updated_at", "sort_order": "desc"})
    assert response.status_code == 200

    # Sort by name asc
    response = client.get("/api/conversations", params={"sort": "name", "sort_order": "asc"})
    assert response.status_code == 200


def test_list_conversations_with_search(client):
    """Test searching conversations."""
    response = client.get("/api/conversations", params={"search": "test"})
    assert response.status_code == 200


def test_get_conversation_not_found(client):
    """Test GET /api/conversations/{uuid} with non-existent UUID."""
    response = client.get("/api/conversations/nonexistent-uuid")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_conversation_tree_not_found(client):
    """Test GET /api/conversations/{uuid}/tree with non-existent UUID."""
    response = client.get("/api/conversations/nonexistent-uuid/tree")

    assert response.status_code == 404
