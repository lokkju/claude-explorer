# Canva Announcement Deck — Style Guide

How to build the LinkedIn announcement carousel for each *Unlocking Your Claude
History* Medium Part, so every Part's deck looks like a set. Codifies the style
we settled on for the **Part 3** deck (Canva design `DAHMAYf0h6s`; Part 2 was
`DAHLZo4YX5k`). The exported PDF lives in the gitignored `LinkedIn/` folder; the
slide *images* are committed under `articles/Attachments/` (see §6).

Companion workflow/gotcha notes (how the Canva MCP behaves) live in the
auto-memory file `project_canva_announcement_decks.md`.

---

## 1. Format & structure

- **12 slides, 1920 × 1080**, dark-navy background throughout.
- **Cover slide:** top-to-bottom order is **title → subtitle → ouroboros image
  (centered) → author name**. The ouroboros (`articles/Attachments/ouroboros.png`)
  is the series mark; reuse it on every cover.
- **Content slides:** a **purple rounded header bar** pinned top-left with an
  **amber/gold title**, then the content below it.
- **Closing slide:** "Jump In" + the install / GitHub / PyPI / Medium links.

## 2. Palette

The deck is **navy + purple + amber/gold**. Use these exact values so rendered
images sit natively on the slides.

| Role | Hex | RGB | Where |
|---|---|---|---|
| Slide / window background (navy) | `#0F142B` | 15,20,43 | slide bg, terminal/JSON window body |
| Card / panel background (**purple**) | `#2F2654` | 47,38,84 | all content cards + header bars |
| Title / header text (**amber/gold**) | `#E2A455` | 226,164,85 | slide titles, card headers |
| Body text (light) | `#CBCBDA` | 203,203,218 | card body copy |
| Window title bar | `#1B2036` | 27,32,54 | terminal/JSON chrome |
| Window border | `#2A2F52` | 42,47,82 | terminal/JSON/card outline |
| Muted / secondary text | `#8B93B8` | 139,147,184 | labels, JSON punctuation, output |
| Sparkle / "Claude" accent (purple) | `#A78BFA` | 167,139,250 | chat "Claude" marker, source sparkle |
| Code keys (purple) | `#B9A3F0` | 185,163,240 | JSON keys |
| Code strings / numbers (amber) | `#D99A5C` | 217,154,92 | JSON strings, `$` prompt, counts |
| Success green | `#62C554` | 98,197,84 | `✓ Connected`, terminal traffic-light |
| Comment green | `#7EA56E` | 126,165,110 | shell `# comments` |
| Traffic lights | `#ED6A5E` / `#F5BF4F` / `#62C554` | — | window red/yellow/green dots |

> Retired: the old **amber card** `#F6B474` (246,180,116). We replaced every
> amber card with the purple `#2F2654` scheme. Do **not** reintroduce amber cards.

## 3. Typography

Match the system fonts so renders blend with Canva text:

- **Sans (titles, body):** SF Pro — `/System/Library/Fonts/SFNS.ttf`
- **Mono (code, terminal, JSON):** SF Mono — `/System/Library/Fonts/SFNSMono.ttf`
- **Italic (emphasis):** SF Pro Italic — `/System/Library/Fonts/SFNSItalic.ttf`

Fake bold for headers with `stroke_width=1, stroke_fill=<same color>` (PIL).

## 4. Core principles (the look we committed to)

1. **Meaningful images, never decoration.** Every image earns its place by
   illustrating the actual point — a real screenshot, a real terminal/JSON
   render, the verbatim origin prompt, a real tool-call transcript. We deleted
   the AI-generated abstract art and replaced it with substance.
2. **Real data.** Use the real numbers, the real prompt (verbatim), the real
   commands and output — not invented examples. (E.g. the genuine
   `list_sessions` result: 9 sessions = 2 real + 7 mis-grouped Gmail.)
3. **Purple cards, not amber** (`#2F2654`), with **amber headers + light body**,
   matching the purple header bars.
4. **Renders match the palette + fonts** so they look native, not pasted-in.
5. **Code / config as monospace "windows"** with macOS traffic-light chrome and
   a title (terminal: `claude-sessions — Terminal`; config: the real filename,
   e.g. `claude_desktop_config.json`). Syntax coloring per §2.
6. **Two-column for text + screenshot** slides: text left, image right,
   top-aligned.
7. **Chat / transcript cards** use product-consistent labels: a muted **"You"**
   over the user line, and **"Claude"** preceded by the purple sparkle (`✦`,
   drawn as a 4-point polygon since the glyph isn't in SF Pro).

## 5. Per-element specs

- **Content card:** purple `#2F2654`, corner radius ~20px (page units / ~40px at
  2× render), amber header (bold), light body. Render **RGBA with transparent
  corners** so the navy slide shows through the rounding. Header at ~62px /
  body at ~129px down from the card top, ~151px in from the left (page units).
- **Terminal / code window:** navy `#0F142B` body, `#1B2036` title bar with three
  traffic-light dots + centered title, `#2A2F52` border, rounded ~22px. Keep the
  longest line within width (drop the mono font size until it fits — ~31px for a
  full `claude mcp add …` line at 1640px wide).
- **JSON / config window:** same chrome; keys `#B9A3F0`, strings `#D99A5C`,
  punctuation `#8B93B8`, filename in the title bar.
- **Italic emphasis** on a single word is only possible inside a rendered image
  (Canva's API sets font style per whole text element, not per word).

## 6. Reusable assets (Part 3 — adapt for the next Part)

Committed under `articles/Attachments/`:

- `ouroboros.png` — series cover mark (reuse every cover).
- `part3-deck-tool-use.png` — real `list_sessions` transcript ("You"/"Claude" card).
- `part3-deck-mcp-tools.png` — `/mcp` tool-description screenshot.
- `part3-deck-terminal.png` — `claude mcp add … → ✓ Connected` terminal (with a `# comment`).
- `part3-deck-slide8-prompt.png` — the verbatim origin prompt as a "You" card.
- `part3-deck-slide9-json.png` — `claude_desktop_config.json` window.
- `part3-card-s5-*`, `-s9-1`, `-s10-*`, `-s11-*`, `-s12-1` — the purple replacement cards.

The PIL render scripts that produced these are the template for the next Part
(transcript card, terminal, JSON window, prompt card, purple cards). Keep the
palette/fonts above; swap the copy.

## 7. Producing the deck (pointer)

Mechanics and Canva-MCP gotchas are in the memory file
`project_canva_announcement_decks.md`. The essentials:

1. Render images with PIL using §2/§3; **commit + push to the public repo** so
   Canva can fetch them by `raw.githubusercontent.com` URL (`upload-asset-from-url`
   is the only upload path).
2. Place via the Canva MCP. **A shape's solid fill color can't be set via the
   API** — to recolor a card, render it as an image and replace the shape + text
   group with it (delete the shape, delete the text *group* id, `insert_fill` at
   the card bbox; the image lands on top).
3. Keep `alt_text` short (a long alt_text 500s the API).
4. Export **PDF at pro quality** into `LinkedIn/` (gitignored), and verify by
   rendering pages out of the exported PDF, not just the editor.
