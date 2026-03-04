"""Config router."""

from fastapi import APIRouter

from ..models import AppConfig
from ..config import get_settings
from ..store import ConversationStore

router = APIRouter(tags=["config"])


@router.get("/config", response_model=AppConfig)
async def get_config() -> AppConfig:
    """Get application configuration."""
    settings = get_settings()
    store = ConversationStore()

    return AppConfig(
        data_dir=str(settings.data_dir),
        conversation_count=store.count_conversations(),
    )