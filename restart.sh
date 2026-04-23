#!/bin/bash
set -e

# Anchor to the script's own directory so the script works regardless of cwd
cd "$(dirname "$0")"

# Kill processes on backend and frontend ports (selective, not broad pkill)
for port in 8000 5173; do
    pids=$(lsof -ti :$port 2>/dev/null) || true
    if [ -n "$pids" ]; then
        echo "Stopping port $port (pids: $pids)"
        echo "$pids" | xargs kill
        sleep 0.5
    fi
done

# Start backend in background
echo "Starting backend on http://localhost:8000"
DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --reload --port 8000 &

# Start frontend in background
echo "Starting frontend on http://localhost:5173"
cd frontend && npm run dev &

sleep 5

open "http://localhost:5173"

wait

