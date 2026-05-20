"""Config router."""

from fastapi import APIRouter, Depends

from ..deps import get_store
from ..models import AppConfig, AppConfigStats
from ..config import get_settings
from ..store import ConversationStore

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

    The conversation count moved to a separate endpoint
    (``/config/stats``) and the field was REMOVED from this response
    entirely (2026-05-06): keeping a hardcoded 0 was misleading to
    anyone curling the endpoint directly.
    """
    settings = get_settings()
    return AppConfig(data_dir=str(settings.data_dir))


@router.get("/config/stats", response_model=AppConfigStats)
async def get_config_stats(
    store: ConversationStore = Depends(get_store),
) -> AppConfigStats:
    """`/config` plus the populated conversation count.

    Slow on cold cache; intended for the Settings page where the user
    is willing to wait.
    """
    settings = get_settings()
    return AppConfigStats(
        data_dir=str(settings.data_dir),
        conversation_count=store.count_conversations(),
    )
