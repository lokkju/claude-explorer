"""Configuration settings for the backend."""

import json
import os
from pathlib import Path
from functools import lru_cache

from pydantic import BaseModel


class Settings(BaseModel):
    """Application settings."""

    data_dir: Path
    # Root directory for Claude Code session JSONLs. The reader walks
    # ``claude_dir / "projects" / <encoded-cwd> / <uuid>.jsonl``. Override
    # via the CLAUDE_DIR env var (set by the Playwright fixture-mode
    # runner) so contributors without ~/.claude/projects on disk can run
    # the e2e suite against committed synthetic fixtures.
    claude_dir: Path

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from environment or config file."""
        env_data_dir = os.environ.get("CLAUDE_EXPORTER_DATA_DIR")
        env_claude_dir = os.environ.get("CLAUDE_DIR")

        # Check config file (used as fallback for fields not set via env).
        config_data_dir: Path | None = None
        config_claude_dir: Path | None = None
        config_path = Path.home() / ".claude-exporter" / "config.json"
        if config_path.exists():
            with open(config_path) as f:
                config = json.load(f)
                if "data_dir" in config:
                    config_data_dir = Path(config["data_dir"])
                if "claude_dir" in config:
                    config_claude_dir = Path(config["claude_dir"])

        data_dir = (
            Path(env_data_dir)
            if env_data_dir
            else config_data_dir
            if config_data_dir
            else Path.home() / ".claude-exporter" / "conversations"
        )
        claude_dir = (
            Path(env_claude_dir)
            if env_claude_dir
            else config_claude_dir
            if config_claude_dir
            else Path.home() / ".claude"
        )
        return cls(data_dir=data_dir, claude_dir=claude_dir)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings.load()