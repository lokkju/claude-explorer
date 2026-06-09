<!--
  Medium series: Unlocking Your Claude History
  Part 3 — USERDOC TWIN (2026-06-02). Practical, cross-platform, no internals.
  Audience: a non-expert who wants to connect the history tool and mine their own conversations.
  Voice: Raymond Peck's "Best Practices for Modern REST APIs in Python" series (PROCESS/99_styleguide.md).
  This is the shorter, how-to twin of part_3_mcp_server.md.
-->

# Part 3 — Let Claude Analyze Your Claude Conversations: A User's Guide

> *"In my longest Claude Code conversation on this project, what did we decide about the database, and what's still open?"*

Ask a brand-new Claude chat that, and it answers, without you scrolling back through thousands of messages. It finds the right conversation, reads only the parts that matter, and hands you the decision and the loose ends.

***In this part of the series, we connect a small tool to Claude on your computer so a brand-new chat can analyze your past Claude conversations, and then we put it to work on three jobs: summarizing a long one down to its decisions, turning Claude's recurring mistakes into better rules, and exporting a clean slice to keep.***

> **Disclaimer**: This is an independent, community-built project. It is not affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.

![An ouroboros: the MCP server reading the very session that built it](Attachments/ouroboros.png)

In the previous installment of this series, we covered the web app that gathers all your Claude conversations (Claude Code, Claude Desktop, and Claude Cowork) into one place you can search and read. If you missed that, make sure to go back and read [Part 1](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-1-f19000c05655) and [Part 2](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-2-using-the-claude-explorer-web-app-user-guide-109191dc24d4) first.

This part comes in two versions; this is the short, practical user guide. If you want the technical deep dive, with the real numbers and the design decisions behind it, read [the longer version](part_3_mcp_server.md). Here I just want to get you connected and productive.

## Contents

- [What This Lets You Do](#what-this-lets-you-do)
- [Connecting It](#connecting-it)
- [Your First Query](#your-first-query)
- [The Outline-First Pattern](#the-outline-first-pattern)
- [Three Things to Ask It to Do](#three-things-to-ask-it-to-do)
- [How I Used This Tool to Write the Series](#how-i-used-this-to-write-the-series)
- [A Few Important Limits](#a-few-important-limits)
- [Wrapping Up!](#wrapping-up)

<a id="what-this-lets-you-do"></a>

## What This Lets You Do

You've had hundreds of conversations with Claude, and the useful one (where you worked out that tricky config, or made the call whose reasoning you'd now have to piece back together) is in there somewhere, but a brand-new chat means starting from scratch. You end up re-explaining context Claude already helped you figure out last week, and losing the part that's often worth the most: the *thinking* that got you there, more than the answer it produced.

This tool fixes that. Once you connect it, a brand-new chat can reach into your saved Claude Code, Claude Desktop, and Claude Cowork history and do four things for you: find old conversations by topic or project, give you a quick outline of any conversation, read back the specific parts you care about, and hand a clean copy of the relevant slice back to your chat.

More importantly, it lets Claude compose these so you can ask a high-level question (*"what did we settle on in my longest Docker conversation? Tell me what we decided, and why."*) and Claude combines the steps for you behind the scenes: find the conversation, skim it, read the parts that matter, and answer. You stay in control the whole time; Claude only looks when you ask it to.
<a id="connecting-it"></a>
## Connecting It

You connect the tool once, and from then on Claude can use it. Nothing runs in the background, and nothing listens on your network; Claude starts the tool itself, only when it needs it. This works the same on macOS, Windows, and Linux; the only difference is one file path for Claude Desktop, which I give for all three below.

One thing that sentence doesn't cover: the server reads only the Claude history already saved on your disk, so your answers are only as complete as that archive. Keeping it complete is a separate setup, and I walk through it in [Part 2](https://medium.com/@raymondpeck/unlocking-your-claude-history-part-2-using-the-claude-explorer-web-app-user-guide-109191dc24d4): the **Refresh** button pulls in your Claude Desktop conversations, and a one-time `install-watcher` step runs an always-on job that saves your Claude Code images before Claude rotates them off disk. If you skipped that in Part 2, set it up first, because the server can't show you what was never captured.

**Claude Code.** Open a terminal and run one command. (It uses `uvx`, which ships with `uv`, a Python tool; if you don't have it yet, [install it first](https://docs.astral.sh/uv/getting-started/installation/).)

```bash
claude mcp add --scope user claude-sessions -- uvx claude-explorer mcp
```

Prefer to edit a file by hand? You can add the server straight to the config Claude Code reads for every project: `~/.claude.json` (`%USERPROFILE%\.claude.json` on Windows). It already holds other settings, so don't replace the file; just add a `claude-sessions` entry under the top-level `mcpServers` key, creating that key if it isn't there:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "type": "stdio",
      "command": "uvx",
      "args": ["claude-explorer", "mcp"]
    }
  }
}
```

Either way, check that it "took" by running:

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
      "type": "stdio",
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

For those, Claude finds and lists the matching conversations and stops there, rather than trying to read everything. But you can send it further in the same breath, and ask it to dig into what it finds:

> *"Find the conversation where we fixed the login bug, and walk me through how we solved it."*

Now Claude composes a couple of steps for you: it finds the right conversation, reads the parts that matter, and answers, all without you naming a single tool. Notice that it still doesn't read the entire conversation to do it. That selective reading is the magic behind how this works without burning through tokens, and it's worth understanding before you go further.
<a id="the-outline-first-pattern"></a>
## The Outline-First Pattern

If you remember one thing from this article, make it this one, because it's what keeps the tool fast and cheap to use.

Some of your conversations are huge, especially Claude Code ones, which can run to thousands of messages. Reading a whole giant conversation at once is an expensive way to work: Claude has to load all of it, which eats into the space it has left to think and slows everything down. The tool's answer is the *outline*, a quick, skimmable summary of a conversation with one line per message. Instead of swallowing the whole thing, Claude pulls the outline first, finds the handful of messages that actually matter, and reads only those.

The good news is that you mostly don't have to ask for any of this. Take that database question from the top of this guide: put something like it to a long conversation, and Claude works outline-first on its own. It skims the outline, picks the few relevant messages, reads them, and answers, without dragging the other few thousand into view. You can still steer it when you want to: *"just give me the outline first"* is a perfectly good thing to say if you'd like to pick the parts yourself. But the principle is the thing to hold onto: Claude can get the outline first, then zoom in to analyze the key parts. It's faster, it's cheaper, and it's how the tool works best.
<a id="three-things-to-ask-it-to-do"></a>
## Three Things to Ask It to Do

Once you're connected, three prompts pay for themselves immediately.

**Summarize a sprawling conversation down to its decisions.** When a project sprawled across a long, winding conversation and you can't remember what you settled on, ask:

> *"What did we actually decide in my longest conversation on the foo project, and what's still open?"*

Claude skims the outline, reads the parts that matter, and hands you back the decisions without you re-reading the whole thing.

**Mine Claude's recurring mistakes into better instructions.** This one is my favorite. If you keep a `CLAUDE.md` (a file of instructions Claude Code reads at the start of each conversation), you can ask Claude to improve it from your own recent history:

> *"Look at my last week of conversations in this project, find the two or three mistakes Claude keeps making, and write me a short list of rules to add to my CLAUDE.md to stop them."*

You read its suggestions, keep the ones you like, and your future conversations get a little smarter. Some of those rules will be specific to one project and belong in its `CLAUDE.md`; others are about how you want Claude to work everywhere, and those can live in your global Claude setup (skills, agents, slash commands...) so every project picks them up. I ran exactly this over my own project, and I write up the real result in [the longer version](part_3_mcp_server.md): it mostly confirmed the rules I already had, which is a good sign, and it found a couple of new ones worth adding.

**Export a clean copy of a slice.** When you want to keep part of a conversation (paste it into notes, a doc, a ticket), ask:

> *"Export the part of that conversation where we wrote the deploy script in Markdown format."*

You get back a clean, paste-ready copy of just that part.
<a id="how-i-used-this-to-write-the-series"></a>
## How I Used This Tool to Write the Series

Here's a real example that's a bit of a mind-bender: I used this tool to help draft this Medium series about itself. That's why I used the Ouroboros image for the Part 3 articles, with the snake eating its own tail. 🤓 I pointed Claude at the build history of this very project, a single Claude Code conversation that had grown to thousands of messages, and asked it to dig out the story:

> *"Summarize the development history of this project, pull out the decisions and the memorable moments, and turn it into a drafting brief for a Medium series."*

It worked the way you'd expect from the outline-first pattern. Claude outlined the giant conversation, found the natural phases of the work, pulled back only the parts that mattered from each one, and turned them into a set of notes we drafted from. No one reads thousands of messages by hand, and pouring them all into a chat at once is the expensive or even impossible mistake the outline exists to prevent.

That flow was part of the plan from the start. The prompt this whole tool grew from, typed into that build session weeks before any of this existed, already laid out what I'd use it for:

> *"I want to build an MCP server into this project, so that Claude Code and Claude Desktop can query our saved sessions. An example use case would be to read through an entire session bit by bit (assuming it won't all fit in context at once), and find mistakes that Claude Code made that we had to correct through followon prompts. This could be used to improve our agent prompts, CLAUDE.md, etc. Another use case would be to read through the session(s) for a project and write a comprehensive blog post about the work that went into it. We might use this session's project as a test case for this."*

Look how much was already there: it named both workflows this article is built on, turning Claude's recurring mistakes into better rules and mining a project's history into an article, long before either happened, plus the context limit the outline-first pattern solves. You're reading the blog post that prompt asked for, mined from the very conversation it was typed into.
<a id="a-few-important-limits"></a>
## A Few Important Limits

Some things to know up front, so nothing surprises you. The tool is **read-only**: it can look at your history, but it can't change or delete any of it, ever. It's **local**: nothing leaves your machine, and there's no server to phone home to. And it's **restrained by design**: Claude uses it only when you ask, so it won't go rummaging through your history on unrelated questions.

One more thing to expect: your archive is *real data*, with all the mess that real data implies. The first time I tried this, my project list came back with a handful of unrelated old chats mixed in, just because they'd run from the same folder months earlier. That's normal. And when a conversation is enormous, the outline-first pattern from above keeps it quick: Claude skims it first, then reads and analyzes only the parts you want.
<a id="wrapping-up"></a>
## Wrapping Up!

Ok, that's enough for today! We connected the history tool to Claude Code and Claude Desktop on your computer, asked it a first question or two, learned the pattern that keeps it fast (outline first, then zoom in), and looked at three really useful workflows: summarizing a sprawling conversation, mining Claude's recurring mistakes into better instructions, and exporting a clean slice of a conversation for reuse. I also showed you how I strung all of that together to mine this very project's history into the series you're reading. If you want the deeper version, with the real numbers and the design story, read [the longer version](part_3_mcp_server.md).

Next time we pivot from *using* the project to *building* it, starting with the reverse-engineering story of how Claude Desktop's conversations get onto your disk in the first place.

Like last time, please comment below with any questions or corrections, and I'd love to hear what you'd ask a brand-new chat to dig out of your own history. If you liked this, please clap and follow me here and on LinkedIn.

See you next time! 🤓
