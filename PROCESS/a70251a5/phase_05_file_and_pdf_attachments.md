# Phase 05 — file_and_pdf_attachments

- **Session:** `a70251a5-b932-4b61-aba1-16a70410b98e`
- **Positions:** `[576..703]`
- **Dates:** 2026-03-04 → 2026-03-04

## Goal
Extend the fetcher so it actually downloads attachment bytes — images first, then
canvas artifacts, then PDFs — instead of leaving dead URLs in the JSON. Along
the way, debug why a known PDF was silently missing from the fetched conversation
and discover that Claude's API uses a second, differently-shaped `files_v2`
field for documents.

## Opening prompt
> yes, add the file download; also check to see if the canvas is captured. The
> last conversation (02971706-ff28-400c-92cb-3e2809b74d0d.json) used the canvas.
> The 0c75b18a-91db-405a-8dd1-6aceb3c41d7d.json conversation has a subtitle
> (.srt) attachment.

— pos=578 `msg=0902b596…` (2026-03-04)

## Key decisions
- Download attachment bytes locally (not just keep URLs) so the archive is
  self-contained and survives Claude server-side expiry. [pos=578 `msg=0902b596…`]
- Treat images, canvas/artifact text, and PDFs as three distinct cases with a
  shared `files/` output directory next to each conversation JSON. [pos=578 `msg=0902b596…`]
- Use two known real conversations as fixtures — one with a canvas
  (`02971706…`) and one with a `.srt` subtitle attachment (`0c75b18a…`) —
  rather than synthetic test data. [pos=578 `msg=0902b596…`]
- Commit the image-download path as its own checkpoint before tackling PDFs,
  to keep the diff reviewable. [pos=649 `msg=d6469a55…`]
- When the PDF conversation (`d2ce8cd7…`) failed to pull the document, debug
  by re-reading the raw JSON rather than guessing at the API. [pos=659 `msg=82391f1f…`]
- Accept that `files` and `files_v2` are two separate fields with incompatible
  shapes and handle each explicitly rather than trying to unify them. [pos=680 `msg=895d7bb9…`]
- After download was working but the JSON still lacked a reference to the PDF,
  stop and re-check the plan before piling on more code. [pos=691 `msg=ee7b85e1…`]

## Code outcome
- `fetcher/` extended to fetch and persist attachment bytes into a per-
  conversation `files/` directory, alongside the existing conversation JSON.
- Attachment handling split into three code paths: flat `files` entries
  (images via `thumbnail_url` / `preview_url`), canvas / artifact text content,
  and `files_v2` entries (PDFs/docs via nested `document_asset.url` and
  `thumbnail_asset.url`). [pos=680 `msg=895d7bb9…`, pos=662 `msg=1a69fed1…`]
- Image-download path committed as a standalone checkpoint once verified end-
  to-end on the fixture conversations. [pos=649 `msg=d6469a55…`]
- PDF path landed after the `files_v2` shape was identified — the bytes now
  show up in `files/` for `d2ce8cd7…`. [pos=681 `msg=4395fa6e…`]

## Missteps / reverts
- Original attachment-download code assumed `files_v2` entries had the same
  flat shape as `files` (top-level `thumbnail_url` / `preview_url`). Because
  the real shape is nested (`document_asset.url`), the PDF URL was simply
  never found and the download silently no-opped — no error, just a missing
  file. Caught only because the user spot-checked a specific conversation.
  [pos=659 `msg=82391f1f…`, pos=680 `msg=895d7bb9…`]
- Even after the bytes were on disk, the conversation JSON still showed
  `"enabled_artifacts_attachments": false` and empty `attachments` arrays,
  which briefly looked like a second bug. Resolved once the user noticed the
  PDF *was* in fact referenced, but from `files_v2` rather than `attachments`.
  [pos=681 `msg=4395fa6e…`, pos=691 `msg=ee7b85e1…`]

## Memorable moments
- > I just fetched a new conversation, d2ce8cd7-4c9f-4b76-9329-288c6a23054a.json
  > It should have a PDF attachment. I see it in the Claude Desktop app, but
  > our fetcher utility didn't get it.
  — pos=659 `msg=82391f1f…` (sender: human)
- > What was the problem?
  — pos=679 `msg=03b58907…` (sender: human)
- > My original code was looking for `thumbnail_url`, `preview_url` etc. as
  > top-level keys in `files_v2`, but the actual URLs are nested inside
  > `thumbnail_asset.url` and `document_asset.url` objects. So the PDF URL
  > was never found.
  — pos=680 `msg=895d7bb9…` (sender: assistant)
- > Great, I now see the PDF in the files/ dir. However, it's not referenced
  > in the JSON!
  — pos=681 `msg=4395fa6e…` (sender: human)
- > I see it in files_v2, thanks. Think about our plan again, and tell me the
  > next steps.
  — pos=691 `msg=ee7b85e1…` (sender: human)

## Tone / mood
Iterative and debugging-heavy — the user drove with concrete reproducers
("this conversation has a canvas", "this one has a PDF") rather than abstract
specs, and forced a re-plan at the end instead of letting the session drift
into more unplanned code.

## Cross-refs
- Upstream: builds directly on Phase 04's working fetcher / mitmproxy pipeline
  (credentials + bulk JSON download); this phase is the first to touch the
  *content* of attachments rather than just conversation metadata.
- Downstream: the `files_v2` discovery and the per-conversation `files/`
  layout become inputs for later phases on rendering (thumbnails, PDF
  previews in the UI) and on export (ensuring Markdown/PDF export can embed
  or link downloaded attachments).
