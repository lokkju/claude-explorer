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
- **Tighter joining of related thoughts. Choppy back-to-back short sentences are an AI-writing tell.** Raymond joins related thoughts using one of three tools, in rough order of preference:

  1. **Semicolons** for parallel / contrastive pairs.
     - ❌ *"The UI is how you browse and read. The MCP server is how another Claude reads."*
     - ✅ *"The UI is how you the human search and browse and read; the MCP server is how another Claude session searches and browses and reads."*

  2. **Comma splices** for a tight reframe of a just-said thing (technically "wrong" per strict grammar, intentionally informal in Raymond's voice).
     - ❌ *"You will not find your conversations. They're not there."*
     - ✅ *"You will not find your conversations, they're not there."*

  3. **Subordinating clauses** (*because, since, however, on the other hand, but also because…*) when the thoughts are cause-and-effect or contrast, not reframing.

  When in doubt between a period and one of the above, and the two clauses are thematically paired (contrast, parallel structure, cause/effect, reframing), avoid the period. Periods go between thematic units, not inside them.

- **Prefer technical vocabulary when it fits.** Small but real: Raymond will pick *query* over *ask*, *iterate* over *loop*, *idempotent* over *safe to re-run*, when the more-technical word is accurate. This is not showing off; it's precision. The "I love it when I get to use the word isomorphic!" moment (in Tone tics) is the archetype.

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
- **Approved signature phrases — keep these when they appear naturally; do not flag them as clichés.** These are part of Raymond's established voice, not AI-assistant tells:
  - *"As I often say, laziness is the mother of invention!"* — used after any "I let the tool do the work" beat.
  - *"I commented the heck out of it."*
  - *"I love it when I get to use the word isomorphic!"* (or similar nerd-delight asides at vocabulary choices).
  - *"I figured out a way, and you're reading this!"*

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

### The "it's not X, it's Y" trope — one-shot example (do not use this construction)

This construction is a top-3 AI-writing tell. Avoid it even when the contrast feels natural. **Just state what it is; drop the negation.**

- ❌ *"The real payoff isn't neatness, it's **learning across silos**."*
- ✅ *"The real payoff is **learning across silos**."*

Other surface forms to avoid with the same fix:

- *"Not X. Y."* (two sentences)
- *"It's less about X and more about Y."*
- *"X is fine, but Y is the point."*

If you genuinely need to negate a prior framing (because the reader is mid-paragraph and needs to unlearn something), just say *"I don't mean X"* once and move on. Don't build paragraphs on the contrast.
