# Backend — Detailed Plan

## Overview

A FastAPI app that serves conversation data from the local JSON files
produced by the fetcher. The frontend talks exclusively to this API.

---

## Endpoints

### Conversations
```
GET  /api/conversations
     ?search=<str>      full-text search across title + message content
     ?starred=<bool>
     ?model=<str>
     ?sort=updated_at|created_at|name  (default: updated_at desc)
     → List[ConversationSummary]

GET  /api/conversations/{uuid}
     → ConversationDetail  (includes messages, resolved into active-branch linear list)

GET  /api/conversations/{uuid}/tree
     → ConversationTree    (full message tree with all branches)
```

### Search
```
GET  /api/search?q=<str>
     → List[SearchResult]  (conversation + matching message snippet)
```

### Export
```
GET  /api/conversations/{uuid}/export/markdown
     → StreamingResponse (text/markdown, attachment)

GET  /api/conversations/{uuid}/export/pdf
     → StreamingResponse (application/pdf, attachment)

GET  /api/export/all/markdown
     → StreamingResponse (application/zip, attachment)
```

### Config
```
GET  /api/config
     → { data_dir: str, conversation_count: int }
```

---

## Data Models (Pydantic)

### ConversationSummary
```python
class ConversationSummary(BaseModel):
    uuid: str
    name: str
    summary: str
    model: str
    created_at: datetime
    updated_at: datetime
    is_starred: bool
    is_temporary: bool
    message_count: int
    human_message_count: int
    has_branches: bool
```

### Message
```python
class ContentBlock(BaseModel):
    type: str           # text | tool_use | tool_result | image
    text: str | None
    name: str | None    # for tool_use
    input: dict | None  # for tool_use
    content: list | None  # for tool_result

class Message(BaseModel):
    uuid: str
    sender: Literal["human", "assistant"]
    text: str
    content: list[ContentBlock]
    created_at: datetime
    updated_at: datetime
    truncated: bool
    parent_message_uuid: str | None
    attachments: list
    files: list
```

### ConversationDetail
```python
class ConversationDetail(ConversationSummary):
    messages: list[Message]           # active branch, linear, root→leaf
    current_leaf_message_uuid: str
```

### ConversationTree
```python
class MessageNode(BaseModel):
    message: Message
    children: list[MessageNode]       # recursive

class ConversationTree(BaseModel):
    uuid: str
    root_messages: list[MessageNode]  # typically one root
    active_path: list[str]            # UUIDs of active branch
```

### SearchResult
```python
class SearchResult(BaseModel):
    conversation_uuid: str
    conversation_name: str
    conversation_updated_at: datetime
    matching_messages: list[MessageSnippet]

class MessageSnippet(BaseModel):
    message_uuid: str
    sender: str
    snippet: str      # surrounding context around the match
    match_start: int  # char offset within snippet
    match_end: int
```

---

## Configuration

Config via environment variable or `~/.claude-exporter/config.json`:

```json
{
  "data_dir": "/Users/rpeck/.claude-exporter/conversations"
}
```

Environment: `CLAUDE_EXPORTER_DATA_DIR`

The backend auto-discovers this at startup. If not set, defaults to
`~/.claude-exporter/conversations`.

---

## Message Tree Resolution

The active branch is resolved by walking backwards from `current_leaf_message_uuid`
following `parent_message_uuid` links until we reach a message with no parent.
Then reverse the list to get root→leaf order.

```python
def resolve_active_branch(messages: list[dict], leaf_uuid: str) -> list[dict]:
    by_uuid = {m["uuid"]: m for m in messages}
    branch = []
    current = by_uuid.get(leaf_uuid)
    while current:
        branch.append(current)
        parent_uuid = current.get("parent_message_uuid")
        current = by_uuid.get(parent_uuid) if parent_uuid else None
    return list(reversed(branch))
```

`has_branches` is True when any message has more than one child.

---

## Export: Markdown

Template for a single conversation:

```markdown
# {conversation.name}

**Model:** {model}  
**Date:** {created_at}  
**Messages:** {count}

---

**You:** {timestamp}

{message text}

---

**Claude:** {timestamp}

{message text}

---
```

Tool use blocks are rendered as fenced code blocks with the tool name.
Tool results are rendered as collapsible `<details>` in the Markdown.

---

## Export: PDF

Use **weasyprint** to render the Markdown→HTML→PDF with a clean stylesheet.
The PDF matches the visual style of the web app.

---

## File Structure

```
backend/
├── pyproject.toml
├── main.py           # FastAPI app, lifespan, router includes
├── config.py         # Settings / config loading
├── models.py         # Pydantic models
├── store.py          # Reads and indexes JSON files from disk
├── search.py         # Full-text search implementation
├── export.py         # Markdown + PDF generation
├── routers/
│   ├── conversations.py
│   ├── search.py
│   └── export.py
└── tests/
    ├── __init__.py
    ├── conftest.py           # fixtures: sample data, test client
    ├── test_store.py
    ├── test_search.py
    ├── test_export.py
    └── test_routers.py
```

---

## Tests

### test_store.py
- `test_loads_conversation_from_json`
- `test_lists_all_conversations_sorted_by_updated_at`
- `test_resolve_active_branch_linear` — simple conversation, no branches
- `test_resolve_active_branch_with_branches` — branched conversation, picks correct path
- `test_has_branches_false_for_linear`
- `test_has_branches_true_for_branched`
- `test_message_count_correct`

### test_search.py
- `test_search_finds_match_in_title`
- `test_search_finds_match_in_message_text`
- `test_search_case_insensitive`
- `test_search_no_results`
- `test_search_returns_snippet_with_context`
- `test_search_multiple_matches_in_one_conversation`

### test_export.py
- `test_markdown_export_includes_all_messages`
- `test_markdown_export_formats_human_message`
- `test_markdown_export_formats_assistant_message`
- `test_markdown_export_handles_tool_use`
- `test_markdown_filename_sanitized`

### test_routers.py (integration, using TestClient)
- `test_list_conversations_returns_200`
- `test_list_conversations_sorted_by_updated_at`
- `test_list_conversations_filter_starred`
- `test_list_conversations_search`
- `test_get_conversation_returns_messages_in_order`
- `test_get_conversation_404_for_unknown_uuid`
- `test_get_conversation_tree`
- `test_export_markdown_returns_file`
- `test_search_endpoint`
- `test_config_endpoint`
