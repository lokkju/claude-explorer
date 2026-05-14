# Contributing to claude-explorer

Thanks for the interest. This is a solo-maintained project; PRs are welcome but please open an issue first for anything bigger than a typo so we can agree on the approach before you write code.

## Prerequisites

- Python 3.11+ (uv will bootstrap if missing)
- Node.js 20+ + npm (for the React frontend build)
- macOS system libs: `brew install pango cairo libffi` (for PDF export)
- Linux system libs: `apt install libpango-1.0-0 libcairo2 libffi-dev` (for PDF export)

## Repo setup

```bash
git clone https://github.com/rpeck/claude-explorer
cd claude-explorer
uv sync --extra dev
cd frontend && npm install && cd ..
uv run playwright install chromium
```

## Running locally (dev mode)

- Backend (with auto-reload):
  `DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run uvicorn backend.main:app --reload --port 8000`
  (On macOS the `DYLD_LIBRARY_PATH` prefix is needed for WeasyPrint; see [CLAUDE.md](./CLAUDE.md) for details.)
- Frontend (separate dev server): `cd frontend && npm run dev`
- Tests:
  - Backend: `uv run pytest backend/tests -q`
  - Vitest: `cd frontend && npm run test:run`
  - Playwright: `cd frontend && npx playwright test`

## Code style

- Python: PEP 8 with type hints; `ruff` + `pyflakes` (CI enforces zero warnings on changed files).
- TypeScript: strict mode, `tsc --noEmit` clean, eslint via vite-plugin; prefer functional components.
- Testing discipline: see [CLAUDE-TESTING.md](./CLAUDE-TESTING.md) for the black-box / spec-driven rules, Playwright "deterministic settle barrier" pattern, and the pre-flight checklist.
- General coding practices and project structure are documented in [CLAUDE.md](./CLAUDE.md).
- Commit messages: conventional commits, no AI attribution lines.

## Pull request process

1. Open an issue describing the change (skip for typos / docs).
2. Fork, branch, commit.
3. Run all three test suites locally before pushing.
4. On PR open, the [CLA Assistant](https://cla-assistant.io) bot will ask you to sign the [Contributor License Agreement](./CLA.md) (one-time, takes 30 seconds via GitHub OAuth).
5. PR review focuses on: test coverage, voice consistency for any article/doc changes, no silent regressions.

## What we don't accept

- PRs that paste official Anthropic source code or API responses beyond the minimal samples already in test fixtures.
- PRs that bypass the credential capture / fetch model (e.g., scraping `claude.ai` HTML); we deliberately use only the same endpoints the official clients use.
- Feature additions without tests.
