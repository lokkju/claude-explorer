"""FastAPI application for Claude Explorer."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import conversations, search, export, config, fetch, bookmarks


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup: verify data directory exists
    settings = get_settings()
    if not settings.data_dir.exists():
        print(f"Warning: Data directory does not exist: {settings.data_dir}")
        print("Creating directory...")
        settings.data_dir.mkdir(parents=True, exist_ok=True)
    else:
        print(f"Data directory: {settings.data_dir}")

    yield

    # Shutdown: nothing to clean up


app = FastAPI(
    title="Claude Explorer",
    description="API for browsing and exporting Claude Desktop conversations",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers under /api prefix
app.include_router(conversations.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(fetch.router, prefix="/api")
app.include_router(bookmarks.router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Claude Explorer",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}