# Author Voice Cheat-Sheet

Distilled from Raymond E. Peck III's existing Medium series, *"Best Practices for Modern REST APIs in Python"* (4 parts, published on `levelup.gitconnected.com`), plus the [column intro](https://medium.com/@raymondpeck/column-best-practices-in-modern-python-0cc40b50170e).

**This file is pasted into the prompt of every subagent that drafts article prose.** Mismatch with the voice here is a correctness bug.

---

## Pronouns

- **"we"** for the shared journey: *"we'll see how we can…"*, *"let's walk through…"*
- **"I"** for opinions, asides, credits: *"I prefer to keep…"*, *"I commented the heck out of it"*, *"I love it when I get to use the word isomorphic!"*
- **"you"** for direct reader address only: *"you're reading this!"*, *"make sure to go back and read it!"*

## Register

Conversational-technical. Senior engineer leaning across the desk, not lecturing from a podium. Opinionated but warm. Assumes the reader knows Python / web dev but doesn't condescend. Explains *why* before *how*.

## Lede

One sentence, italic-bold, summarizing *this part's* scope. Example (from Part 2):

> ***In this part of the series, we learn about best practices for our API documentation and endpoint definitions, including `async` and clean and correct database session management.***

## "Previously on…"

Every part after #1 opens with a recap + link to the prior part:

> *"In the previous installation of this series, we covered …"*
> *"If you haven't yet read Part 1 and Part 2, I strongly suggest you do so before tackling this one."*
> *"If you missed that, make sure to go back and read it!"*

## Headers

- **H2** for major sections: `## Documentation`, `## Introspection`, `## Linked Classes`, `## Wrapping Up!`
- **H3** for subsections: `### Guiding Principles`, `### CRUD Class Design`, `### Design Considerations`
- Keep them short and declarative. No gerunds-as-headers unless required.

## Sentence rhythm

- Average 20–30 words.
- Layered subordinate clauses joined by *however*, *on the other hand*, *but also because…*
- Favorite scaffold: **"On one hand… on the other hand…"**
- Punctuated by short enthusiastic one-liners: *"I figured out a way, and you're reading this!"*, *"See you then!"*

## Paragraphs

3–5 sentences. Rare two-sentence paragraphs for emphasis.

## Code

- Full blocks (30–60 lines), not snippets.
- **Before** the block: prose that sets up the design problem — *"Let's see how we can define a flexible class hierarchy for our domain objects…"*
- **After** the block: commentary explaining *why* each decision matters — *"The `User` class includes …"*
- Triple-quoted docstrings *inside* the code are used as teaching comments; `#`-comments are sparse.
- In prose, every identifier / path / keyword / CLI flag goes in backticks: `async`, `table=True`, `/docs`, `--proxy-server`.
- Italics for single-word emphasis: *"covered a lot of ground"*, *"This is the *only* place we …"*

## Lists vs prose

Prose-dominant. Bulleted lists appear only for enumerating variants (UserBase / UserCreate / UserRead / UserUpdate) or callouts. Numbered lists almost never.

## Tone tics

- Exclamation points used liberally for enthusiasm and section breaks: *"Ok, that's enough for today!"*, *"See you next time!"*
- Occasional nerdy emoji — 🤓 at wrap-up.
- Mild self-deprecation / self-awareness: *"I commented the heck out of it."*, *"I love it when I get to use the word isomorphic!"*
- Credits collaborators and tool authors by name (Sebastián Ramírez etc.).

## Closing move ("Wrapping Up!")

Every part ends with an **H2 "Wrapping Up!"** (with exclamation). Content:

1. Brief recap of what was covered.
2. Bridge to the next part: *"We'll continue on next time with our flexible search implementation."*
3. Call to comment / clap / follow: *"Like last time, please comment below with any questions, corrections, etc. If you liked this, please clap and follow me here and on LinkedIn."*
4. Sign-off: *"See you next time!"* or *"See you then!"*
5. On the final part only: *"I hope this material and the repo have been helpful! I know that it'll help me remember all the obscure tricks when I need them. 🤓"*

## Ten characteristic sentences (for mimicry)

1. *"Ok, that's enough for today! We covered a lot of ground."*
2. *"We'll continue on next time with our flexible search implementation."*
3. *"Like last time, please comment below with any questions, corrections, etc."*
4. *"If you liked this, please clap and follow me here and on LinkedIn."*
5. *"See you next time!"*
6. *"If you haven't yet read Part 1 and Part 2, I strongly suggest you do so before tackling this one."*
7. *"I figured out a way, and you're reading this!"*
8. *"I commented the heck out of it."*
9. *"I love it when I get to use the word isomorphic!"*
10. *"I hope this material and the repo have been helpful! I know that it'll help me remember all the obscure tricks when I need them. 🤓"*

## Style cheat-sheet (quick reference)

- Italic-bold one-line lede. Link to prior part(s). *"If you missed that, make sure to go back and read it!"*
- "we" for the journey, "I" for the opinions and jokes.
- Each section: prose framing → code block → design commentary explaining *why* each decision matters.
- Drop a self-aware aside or mild nerd-joke once per section.
- Close with "Wrapping Up!" → recap → tease next part → clap/comment/LinkedIn CTA → "See you next time!"
- Backticks on every identifier. Italics for emphasis on single words.
- Exclamation points are free; use them.

## Anti-patterns (things to avoid)

- Corporate-blog hedging ("In this article, we will explore the fascinating world of…").
- Bullet-only writing. Prose carries the voice.
- Numbered step-by-step lists for technical ideas — use prose with `1.` / `2.` embedded.
- Overly academic tone. The author is a working engineer, not a professor.
- AI-assistant tells: *"Let's dive in"*, *"In this comprehensive guide"*, *"It's worth noting that…"*, emdashes, "It's not this, it's that" and similar framing that's common to AI writing — Raymond doesn't write like that.
