"""Configuration settings for the backend."""

import json
import os
from pathlib import Path
from functools import lru_cache

from pydantic import BaseModel


class Settings(BaseModel):
    """Application settings."""

    data_dir: Path

    @classmethod
    def load(cls) -> "Settings":
        """Load settings from environment or config file."""
        # Check environment variable first
        env_data_dir = os.environ.get("CLAUDE_EXPORTER_DATA_DIR")
        if env_data_dir:
            return cls(data_dir=Path(env_data_dir))

        # Check config file
        config_path = Path.home() / ".claude-exporter" / "config.json"
        if config_path.exists():
            with open(config_path) as f:
                config = json.load(f)
                if "data_dir" in config:
                    return cls(data_dir=Path(config["data_dir"]))

        # Default
        return cls(data_dir=Path.home() / ".claude-exporter" / "conversations")


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings.load()