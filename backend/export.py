"""Export functionality for Markdown and PDF."""

import io
import re
import zipfile
from datetime import datetime

from .models import ConversationDetail, Message, ContentBlock


def sanitize_filename(name: str) -> str:
    """Sanitize a string to be safe for use as a filename."""
    # Remove or replace invalid characters
    sanitized = re.sub(r'[<>:"/\\|?*]', "", name)
    # Replace whitespace with underscores
    sanitized = re.sub(r"\s+", "_", sanitized)
    # Limit length
    if len(sanitized) > 100:
        sanitized = sanitized[:100]
    return sanitized or "conversation"


def format_timestamp(dt: datetime) -> str:
    """Format a datetime for display."""
    return dt.strftime("%Y-%m-%d %H:%M")


def render_content_block(block: ContentBlock, indent: int = 0) -> str:
    """Render a content block to Markdown."""
    prefix = "  " * indent

    if block.type == "text" and block.text:
        return block.text

    if block.type == "tool_use":
        lines = [f"{prefix}**Tool: {block.name}**"]
        if block.input:
            import json

            input_str = json.dumps(block.input, indent=2)
            lines.append(f"{prefix}```json\n{input_str}\n{prefix}```")
        return "\n".join(lines)

    if block.type == "tool_result" and block.content:
        lines = [f"{prefix}<details>", f"{prefix}<summary>Tool Result</summary>", ""]
        for child in block.content:
            lines.append(render_content_block(child, indent + 1))
        lines.extend(["", f"{prefix}</details>"])
        return "\n".join(lines)

    return ""


def message_to_markdown(message: Message) -> str:
    """Convert a single message to Markdown."""
    sender = "You" if message.sender == "human" else "Claude"
    timestamp = format_timestamp(message.created_at)

    lines = [f"**{sender}:** *{timestamp}*", ""]

    # Render content blocks
    if message.content:
        for block in message.content:
            rendered = render_content_block(block)
            if rendered:
                lines.append(rendered)
    elif message.text:
        lines.append(message.text)

    lines.append("")
    lines.append("---")
    lines.append("")

    return "\n".join(lines)


def conversation_to_markdown(conversation: ConversationDetail) -> str:
    """Convert a conversation to Markdown."""
    lines = [
        f"# {conversation.name}",
        "",
        f"**Model:** {conversation.model}",
        f"**Created:** {format_timestamp(conversation.created_at)}",
        f"**Messages:** {conversation.message_count}",
        "",
        "---",
        "",
    ]

    for message in conversation.messages:
        lines.append(message_to_markdown(message))

    return "\n".join(lines)


def conversation_to_html(conversation: ConversationDetail) -> str:
    """Convert a conversation to HTML for PDF rendering."""
    # Basic HTML template with embedded CSS
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{conversation.name}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }}
        h1 {{
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }}
        .meta {{
            color: #666;
            font-size: 14px;
            margin-bottom: 30px;
        }}
        .message {{
            margin-bottom: 24px;
            padding: 16px;
            border-radius: 8px;
        }}
        .message.human {{
            background: #e3f2fd;
        }}
        .message.assistant {{
            background: #f5f5f5;
        }}
        .message-header {{
            font-weight: bold;
            margin-bottom: 8px;
            color: #555;
        }}
        .message-header .timestamp {{
            font-weight: normal;
            font-size: 12px;
            color: #888;
        }}
        .message-content {{
            white-space: pre-wrap;
        }}
        pre {{
            background: #f8f8f8;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
            overflow-x: auto;
            font-size: 13px;
        }}
        code {{
            font-family: 'SF Mono', 'Fira Code', monospace;
        }}
        .tool-use {{
            background: #fff3e0;
            border: 1px solid #ffb74d;
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
        }}
        .tool-result {{
            background: #e8f5e9;
            border: 1px solid #81c784;
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
        }}
        hr {{
            border: none;
            border-top: 1px solid #eee;
            margin: 20px 0;
        }}
    </style>
</head>
<body>
    <h1>{conversation.name}</h1>
    <div class="meta">
        <strong>Model:</strong> {conversation.model}<br>
        <strong>Created:</strong> {format_timestamp(conversation.created_at)}<br>
        <strong>Messages:</strong> {conversation.message_count}
    </div>
"""

    for message in conversation.messages:
        sender = "You" if message.sender == "human" else "Claude"
        timestamp = format_timestamp(message.created_at)

        # Get message content
        content_html = ""
        if message.content:
            for block in message.content:
                content_html += render_content_block_html(block)
        elif message.text:
            content_html = escape_html(message.text)

        html += f"""
    <div class="message {message.sender}">
        <div class="message-header">
            {sender} <span class="timestamp">{timestamp}</span>
        </div>
        <div class="message-content">{content_html}</div>
    </div>
"""

    html += """
</body>
</html>
"""
    return html


def escape_html(text: str) -> str:
    """Escape HTML special characters."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_content_block_html(block: ContentBlock) -> str:
    """Render a content block to HTML."""
    if block.type == "text" and block.text:
        return escape_html(block.text)

    if block.type == "tool_use":
        import json

        input_str = json.dumps(block.input, indent=2) if block.input else ""
        return f"""
        <div class="tool-use">
            <strong>Tool: {escape_html(block.name or '')}</strong>
            <pre><code>{escape_html(input_str)}</code></pre>
        </div>
        """

    if block.type == "tool_result" and block.content:
        result_html = ""
        for child in block.content:
            result_html += render_content_block_html(child)
        return f"""
        <div class="tool-result">
            <strong>Tool Result</strong>
            {result_html}
        </div>
        """

    return ""


def create_pdf(conversation: ConversationDetail) -> bytes:
    """Create a PDF from a conversation using WeasyPrint."""
    try:
        from weasyprint import HTML
    except ImportError:
        raise RuntimeError(
            "WeasyPrint is required for PDF export. Install with: pip install weasyprint"
        )

    html_content = conversation_to_html(conversation)
    pdf_bytes = HTML(string=html_content).write_pdf()
    return pdf_bytes


def create_markdown_zip(conversations: list[ConversationDetail]) -> bytes:
    """Create a ZIP file containing all conversations as Markdown."""
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for conv in conversations:
            filename = f"{sanitize_filename(conv.name)}.md"
            content = conversation_to_markdown(conv)
            zf.writestr(filename, content.encode("utf-8"))

    buffer.seek(0)
    return buffer.read()