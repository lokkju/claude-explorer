"""Tests for the search endpoint."""


def test_search_requires_query(client):
    """Test that search requires a query parameter."""
    response = client.get("/api/search")

    # Should return 422 for missing required parameter
    assert response.status_code == 422


def test_search_with_query(client):
    """Test search with a query string."""
    response = client.get("/api/search", params={"q": "test"})

    assert response.status_code == 200
    # Response is now a SearchResponse envelope, not a bare list.
    body = response.json()
    assert isinstance(body, dict)
    assert isinstance(body["results"], list)


def test_search_with_source_filter(client):
    """Test search with source filter."""
    response = client.get("/api/search", params={"q": "test", "source": "CLAUDE_AI"})
    assert response.status_code == 200

    response = client.get("/api/search", params={"q": "test", "source": "CLAUDE_CODE"})
    assert response.status_code == 200


def test_search_empty_query(client):
    """Test search with empty query string."""
    response = client.get("/api/search", params={"q": ""})

    # Should handle empty query gracefully
    # (might return validation error or empty results)
    assert response.status_code in [200, 422]
