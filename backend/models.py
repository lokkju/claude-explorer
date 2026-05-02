"""Pydantic models for the API."""

from datetime import datetime
from typing import Literal, Any

from pydantic import BaseModel, Field


class ContentBlock(BaseModel):
    """A content block within a message."""

    type: str  # text | tool_use | tool_result | image
    text: str | None = None
    name: str | None = None  # for tool_use
    input: dict[str, Any] | None = None  # for tool_use
    content: list["ContentBlock"] | None = None  # for tool_result


class Message(BaseModel):
    """A single message in a conversation."""

    uuid: str
    sender: Literal["human", "assistant"]
    text: str
    content: list[ContentBlock] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    truncated: bool = False
    parent_message_uuid: str | None = None
    attachments: list[Any] = Field(default_factory=list)
    files: list[Any] = Field(default_factory=list)


class SubagentSummary(BaseModel):
    """Summary of a subagent conversation."""

    uuid: str
    agent_id: str
    name: str
    model: str = ""
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ConversationSummary(BaseModel):
    """Summary of a conversation for list views."""

    uuid: str
    name: str
    summary: str = ""
    model: str = ""
    created_at: datetime
    updated_at: datetime
    is_starred: bool = False
    is_temporary: bool = False
    message_count: int = 0
    human_message_count: int = 0
    has_branches: bool = False
    source: Literal["CLAUDE_AI", "CLAUDE_CODE"] = "CLAUDE_AI"
    project_path: str | None = None  # For Claude Code sessions
    project_name: str | None = None  # Short name extracted from project_path
    git_branch: str | None = None  # For Claude Code sessions
    # Multi-org metadata (cowork-multi-org C3). Null for legacy untagged
    # JSONs that haven't been re-fetched yet — UI surfaces these under the
    # "Untagged (re-fetch to assign workspace)" group.
    organization_id: str | None = None
    organization_name: str | None = None
    subagents: list[SubagentSummary] = Field(default_factory=list)  # Nested agent conversations

    def model_post_init(self, __context: Any) -> None:
        """Compute project_name from project_path after initialization."""
        if self.project_path and not self.project_name:
            # Extract just the folder name from the full path
            # e.g., /Users/rpeck/Source/my-project -> my-project
            path = self.project_path.rstrip("/")
            self.project_name = path.split("/")[-1] if "/" in path else path


class CompactMarker(BaseModel):
    """A /compact event extracted from a Claude Code conversation."""

    message_uuid: str
    summary_text: str
    timestamp: str
    kind: Literal["auto", "manual"]
    user_prompt: str | None = None


class ConversationDetail(ConversationSummary):
    """Full conversation detail including messages."""

    messages: list[Message] = Field(default_factory=list)
    current_leaf_message_uuid: str = ""
    file_path: str | None = None  # Path to the source file (JSON or JSONL)
    compact_markers: list[CompactMarker] = Field(default_factory=list)


class MessageNode(BaseModel):
    """A node in the message tree."""

    message: Message
    children: list["MessageNode"] = Field(default_factory=list)


class ConversationTree(BaseModel):
    """Full message tree with all branches."""

    uuid: str
    root_messages: list[MessageNode] = Field(default_factory=list)
    active_path: list[str] = Field(default_factory=list)


class MessageSnippet(BaseModel):
    """A snippet from a message matching a search."""

    message_uuid: str
    sender: str
    snippet: str
    match_start: int
    match_end: int
    created_at: datetime | None = None


class SearchResult(BaseModel):
    """Search result with matching messages."""

    conversation_uuid: str
    conversation_name: str
    conversation_updated_at: datetime
    conversation_created_at: datetime
    project_name: str | None = None
    matching_messages: list[MessageSnippet] = Field(default_factory=list)


class AppConfig(BaseModel):
    """Application configuration for the frontend."""

    data_dir: str
    conversation_count: int