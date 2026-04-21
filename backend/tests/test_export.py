"""Tests for the export endpoints."""


def test_export_markdown_not_found(client):
    """Test exporting non-existent conversation."""
    response = client.get("/api/conversations/nonexistent/export/markdown")

    assert response.status_code == 404


def test_export_pdf_not_found(client):
    """Test PDF export for non-existent conversation."""
    response = client.get("/api/conversations/nonexistent/export/pdf")

    assert response.status_code == 404


def test_export_markdown_with_tools_param(client):
    """Test markdown export with include_tools parameter."""
    # Even if conversation doesn't exist, the parameter should be accepted
    response = client.get(
        "/api/conversations/nonexistent/export/markdown",
        params={"include_tools": "false"}
    )

    # Should still return 404 for missing conversation (not 422 for bad param)
    assert response.status_code == 404
