"""Config router."""

from fastapi import APIRouter

from ..models import AppConfig
from ..config import get_settings

router = APIRouter(tags=["config"])


@router.get("/config", response_model=AppConfig)
async def get_config() -> AppConfig:
    """Get application configuration.

    Bug A 2026-05-03: this endpoint must be fast — both
    ``ConnectionStatus.checkConnection`` (with a 5s ``AbortSignal``
    timeout) and ``useConfig`` poll it on every page load, and React
    StrictMode in dev fires both effects twice → up to four parallel
    cold calls. Previously this returned ``conversation_count`` from
    ``ConversationStore.count_conversations()``, which walks every
    JSON file on disk (~2.5s for ~600 conversations). Four serialized
    walks blow past the 5s timeout and trigger the connection retry
    loop, which manifested as the "Connecting to Backend" modal
    cycling through retries.

    Conversation count moved to a separate endpoint
    (``/config/stats``) that callers use only when actually needed
    (Settings page).
    """
    settings = get_settings()
    return AppConfig(
        data_dir=str(settings.data_dir),
        conversation_count=0,
    )


@router.get("/config/stats", response_model=AppConfig)
async def get_config_stats() -> AppConfig:
    """Same as /config but populates conversation_count.

    Slow on cold cache; intended for the Settings page where the user
    is willing to wait.
    """
    from ..store import ConversationStore

    settings = get_settings()
    store = ConversationStore()
    return AppConfig(
        data_dir=str(settings.data_dir),
        conversation_count=store.count_conversations(),
    )
