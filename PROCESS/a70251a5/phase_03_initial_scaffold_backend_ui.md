# Phase 03 — initial_scaffold_backend_ui

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[113..335]`
- **Dates:** 2026-03-03 → 2026-03-04

## Goal
First real code-writing phase: stand up a React 18 + TypeScript + Vite + Tailwind v4 + shadcn/ui frontend on mock data, then an end-to-end FastAPI backend (list / detail / search / Markdown / PDF), wire the frontend to it, and land the `uv`-managed local `.venv` + dependency-tracking conventions (npm `package.json` + `pyproject.toml`) that the project will live by.

## Opening prompt
> Make sure that you track the dependencies for both npm and Python (e.g., pyproject.toml)

— pos=113 `msg=33ae84d6…` (2026-03-03)

## Key decisions
- Track dependencies in both `package.json` and `pyproject.toml` from the very first commit of real code — never let either side drift into "whatever happens to be installed." [pos=113 `msg=33ae84d6…`]
- Ship the frontend first against an in-process `USE_MOCK_DATA` flag so the UI shape is usable before the backend exists; flip the flag once the backend lands. [pos=207 `msg=fa2dc7ba…`]
- When the scaffold was half-functional (Markdown/PDF download broken, search only filtering titles), pick "Build the backend" over "mock the exports" or "polish the FE further" — fix the dependency, not the symptom. [pos=209 `msg=682b28dd…`]
- Tech stack locked in: React 18 + TypeScript, Vite, Tailwind CSS v4 (with `@theme` tokens), shadcn/ui, TanStack Query, React Router v7. [pos=210 `msg=169cc98c…` (context-continuation recap)]
- Backend layout cemented as `backend/{main,config,models,store,search,export}.py` plus `backend/routers/{conversations,search,export,config}.py` — the same layout still present today. [pos=304 `msg=08703200…`]
- Use **`uv`** to maintain a project-local `.venv`, and document it in `CLAUDE.md` — the user interrupted a tool call to make this non-negotiable. [pos=262 `msg=4746a23b…`]
- PDF export via WeasyPrint is kept, despite its system-library tax (`brew install pango cairo libffi`, plus `DYLD_LIBRARY_PATH=/opt/homebrew/lib` at runtime) — document the prereq, don't drop the feature. [pos=306 `msg=729dcfd9…`, pos=333 `msg=2b803d27…`]
- After backend lands, explicitly ask "what's next?" rather than autopilot — and the answer is *the fetcher*, not more UI polish, because without it there are no real conversations to browse. [pos=334 `msg=5325c940…`, pos=335 `msg=cbb24da4…`]

## Code outcome
- **Frontend (new):** full Vite + React + TS scaffold — `frontend/vite.config.ts`, `frontend/src/index.css` (Tailwind v4 `@theme`), `frontend/src/lib/{types,api,queryClient,mockData}.ts`, `frontend/src/hooks/useConversations.ts`, `frontend/src/components/layout/{RootLayout,Sidebar}.tsx`, `frontend/src/components/conversation/ConversationList.tsx`, `frontend/src/routes/ConversationPage.tsx`, `frontend/src/components/message/{MessageBubble,MarkdownRenderer}.tsx`, `frontend/src/components/ui/{Button,Input,Badge,ScrollArea}.tsx`.
- **Backend (new):** `backend/{__init__,main,config,models,store,search,export}.py` and `backend/routers/{conversations,search,export,config}.py`; endpoints live: `GET /api/conversations`, `/api/conversations/{uuid}`, `/api/conversations/{uuid}/tree`, `/api/search?q=`, `/api/conversations/{uuid}/export/{markdown,pdf}`, `/api/config`.
- **Tooling:** `pyproject.toml` grew FastAPI/uvicorn/pydantic/httpx/click/weasyprint; `CLAUDE.md` updated with the `uv sync` / `uv run uvicorn …` workflow and the WeasyPrint `DYLD_LIBRARY_PATH=/opt/homebrew/lib` note.
- **Shipped at end of phase:** frontend on `:5173` proxying `/api` to backend on `:8000`, 3 sample conversations in `~/.claude-exporter/conversations/`, Markdown export working, PDF export working.
- **Deferred:** the actual fetcher (Phase 04), branch visualization, keyboard shortcuts, tests, README/packaging polish.

## Missteps / reverts
- First attempt at "Build the backend" blew through the context window — Phase 03 has a literal `This session is being continued from a previous conversation that ran out of context…` recap at pos=210 `msg=169cc98c…`; the downstream agent resumed without asking. The recap itself becomes an artifact of the phase.
- Backend was being set up to install Python packages outside of `uv`-managed `.venv` — user interrupted the tool call twice (pos=261 `msg=c54e1af5…`, pos=269 `msg=b9ffcf09…`) to force "use `uv`, document it in `CLAUDE.md`." Correction landed; both interrupts were in the service of the same rule.
- PDF export import-errored on first run because Pango/Cairo weren't installed; resolved by `brew install pango cairo libffi` at pos=306 `msg=729dcfd9…` plus a documented `DYLD_LIBRARY_PATH=/opt/homebrew/lib` prefix.
- A couple of TypeScript errors (`erasableSyntaxOnly` on the `ApiError` class constructor, `ConversationFilters` not assignable to `Record<string, unknown>`, unused `Download`/`Copy` imports) were silently fixed inside the scaffold before commit.

## Memorable moments
- > Make sure that you track the dependencies for both npm and Python (e.g., pyproject.toml)
  — pos=113 `msg=33ae84d6…` (sender: human)
- > Ok, thanks. Some parts aren't functional yet, like Markdown and PDF download. Search is only partially working.
  — pos=207 `msg=fa2dc7ba…` (sender: human)
- > You should be using uv to maintain a local .venv. Document this in CLAUDE.md.
  — pos=262 `msg=4746a23b…` (sender: human)

## Tone / mood
Pragmatic and opinionated: the user hands off broad scaffolding but stays vigilant about the meta-rules — dependency tracking, `uv` for the venv, no surprises — and interrupts tool calls the moment those rules are about to be violated.

## Cross-refs
- Upstream: executes `PLANS/overview.md` Phases 2 (backend) and 3 (frontend) out of order (FE first, then BE) relative to the original plan, which had the fetcher at Phase 1; the opening prompt's dependency-tracking rule enforces discipline set up by Phase 01's "no self-credit in commits" rule.
- Downstream: Phase 04 answers the "what are the next steps?" at pos=334 by building the fetcher and mitmproxy credential capture; the `uv` / `CLAUDE.md` convention established here persists through every later phase; the backend router skeleton `backend/routers/{conversations,search,export,config}.py` is what Phase 11's caching work and Phase 10's local-Claude-Code-files unification refactor against.
