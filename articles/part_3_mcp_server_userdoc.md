<!--
  Medium series: Unlocking Your Claude History
  Part 3 — USERDOC TWIN (2026-06-02). Practical, cross-platform, no internals.
  Audience: a non-expert who wants to connect the history tool and mine their own conversations.
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series (PROCESS/99_styleguide.md).
  This is the shorter, how-to twin of part_3_mcp_server.md.
-->

# Part 3 — Letting a Fresh Claude Read Your Old Claude Chats

***In this part of the series, we connect a small tool to Claude on your computer so a brand-new chat can read and search your past Claude conversations, and then we put it to work on three jobs: summarizing a long one down to its decisions, turning Claude's recurring mistakes into better rules, and exporting a clean slice to keep.***

> **Disclaimer**: This is an independent, community-built project. It is not affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.

![An ouroboros: the MCP server reading the very session that built it](Attachments/ouroboros.png)

In the previous installation of this series, we covered the web app that gathers all your Claude conversations (both Claude Desktop and Claude Code) into one place you can search and read. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) and [Part 2](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-2-using-the-claude-explorer-web-app-user-guide-109191dc24d4) first.

This is the short, practical version. If you want the deeper tour, with the real numbers, the design decisions, and the story of how I used this tool to help write the series, read [the longer version](part_3_mcp_server.md). Here I just want to get you connected and productive.

## Contents

- [What This Lets You Do](#what-this-lets-you-do)
- [Connecting It](#connecting-it)
- [Your First Query](#your-first-query)
- [The Outline-First Habit](#the-outline-first-habit)
- [Three Things to Ask It to Do](#three-things-to-ask-it-to-do)
- [A Few Important Limits](#a-few-important-limits)
- [Wrapping Up!](#wrapping-up)

<a id="what-this-lets-you-do"></a>

## What This Lets You Do

You've had hundreds of conversations with Claude, and the useful one (where you worked out that tricky config, or made the decision you can't quite reconstruct) is in there somewhere, but a fresh chat means starting from scratch. You end up re-explaining context Claude already helped you figure out last week, and losing the part that's often worth the most: the *thinking* that got you there, more than the answer it produced.

This tool fixes that. Once you connect it, a brand-new Claude chat can reach into your saved Claude Desktop and Claude Code history and do four things for you: find old conversations by topic or project, give you a quick outline of a long one, read back the specific parts you care about, and export a clean copy of a slice you want to keep. You stay in control the whole time; Claude only looks when you ask it to.

<a id="connecting-it"></a>

## Connecting It

You connect the tool once, and from then on Claude can use it. There's nothing running in the background and nothing listening on your network; Claude starts the tool itself, only when it needs it. This works the same on macOS, Windows, and Linux; the only difference is one file path for Claude Desktop, which I give for all three below.

**Claude Code.** Open a terminal and run one command. (It uses `uvx`, which ships with `uv`, a Python tool; if you don't have it yet, [install it first](https://docs.astral.sh/uv/getting-started/installation/).)

```bash
claude mcp add --scope user claude-sessions -- uvx claude-explorer mcp
```

To check that it took, run:

```bash
claude mcp list
```

You should see `claude-sessions` in the list.

**Claude Desktop.** The easiest way to open its config file is from inside the app: **Settings → Developer → Edit Config**. Or open it by hand at the path for your OS:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add this block:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "uvx",
      "args": ["claude-explorer", "mcp"]
    }
  }
}
```

Then **fully quit Claude Desktop and reopen it.** Closing the window isn't enough; Claude only reads that file when it starts up. After it reopens, start a new chat and the history tools will be available.

<a id="your-first-query"></a>

## Your First Query

You don't have to learn any commands. You just ask, in plain English, and Claude figures out which tool to use. Good first questions look like:

> *"Find all my conversations for the claude-explorer project."*

> *"Search my Claude history for the chat where we set up Docker."*

Notice what Claude does here: it finds and lists the matching conversations first, rather than trying to read everything. That's the whole trick to using this well, and it's worth understanding before you go further.

<a id="the-outline-first-habit"></a>

## The Outline-First Habit

If you remember one habit from this article, make it this one, because it's what keeps the tool fast and cheap to use.

Some of your conversations are huge, especially Claude Code ones, which can run to thousands of messages. If you ask Claude to read a whole giant conversation at once, it has to load all of it, which eats into the space it has left to think, and slows everything down. So don't. Instead, ask for the outline first:

> *"Give me an outline of that conversation, then I'll tell you which parts to read."*

Claude comes back with a quick, skimmable summary of the conversation (a line per message, with the gist of each), and *you* pick the interesting bits. Then you say *"read the part where we decided on the database"* and it reads just that. Outline first, then zoom in. It's faster, it's cheaper, and it's how the tool works best.

<a id="three-things-to-ask-it-to-do"></a>

## Three Things to Ask It to Do

Once you're connected, three jobs pay for themselves immediately.

**Summarize a sprawling conversation down to its decisions.** When a project sprawled across a long, winding conversation and you can't remember what you settled on, ask:

> *"Outline my longest conversation in the foo project, then give me the key decisions we made and what's still open."*

Claude skims the outline, reads the parts that matter, and hands you back the decisions without you re-reading the whole thing.

**Mine Claude's recurring mistakes into better instructions.** This one is my favorite. If you keep a `CLAUDE.md` (a file of instructions Claude Code reads at the start of each conversation), you can ask Claude to improve it from your own recent history:

> *"Look at my last week of conversations in this project, find the two or three mistakes Claude keeps making, and write me a short list of rules to add to my CLAUDE.md to stop them."*

You read its suggestions, keep the ones you like, and your future conversations get a little smarter. I ran exactly this over my own project, and I'll tell you the real result in [the longer version](part_3_mcp_server.md): it mostly confirmed the rules I already had, which is a good sign, and it found a couple of new ones worth adding.

**Export a clean copy of a slice.** When you want to keep part of a conversation (paste it into notes, a doc, a ticket), ask:

> *"Export the part of that conversation where we wrote the deploy script in Markdown format."*

You get back a clean, paste-ready copy of just that stretch.

<a id="a-few-important-limits"></a>

## A Few Important Limits

A few things to know up front, so nothing surprises you. The tool is **read-only**: it can look at your history, but it can't change or delete any of it, ever. It's **local**: nothing leaves your machine, and there's no server to phone home to. And it's **restrained by design**: Claude is told to use it only when you ask, so it won't go rummaging through your history on unrelated questions.

One more thing to expect: your archive is *real data*, with all the mess that real data implies. The first time I tried this, my project list came back with a handful of unrelated old chats mixed in, just because they'd run from the same folder months earlier. That's normal. And when a conversation is enormous, remember the habit from above: ask for the outline first, then the parts you want.

<a id="wrapping-up"></a>

## Wrapping Up!

Ok, that's enough for today! We connected the history tool to Claude Code and Claude Desktop on your computer, asked it a first question or two, learned the one habit that keeps it fast (outline first, then zoom in), and tried three jobs worth doing: summarizing a sprawling conversation, mining Claude's recurring mistakes into better instructions, and exporting a clean slice. If you want the deeper version, with the real numbers and the design story, read [the longer version](part_3_mcp_server.md).

Next time we pivot from *using* the project to *building* it, starting with the reverse-engineering story of how Claude Desktop's conversations get onto your disk in the first place.

Like last time, please comment below with any questions or corrections, and I'd love to hear what you'd ask a fresh Claude chat to dig out of your own history. If you liked this, please clap and follow me here and on LinkedIn.

See you next time! 🤓
