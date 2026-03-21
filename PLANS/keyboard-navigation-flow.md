# Keyboard Navigation Flow Diagrams

## State Transition Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application Start                        │
│                     focusArea = 'list'                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  LIST FOCUSED  │◄──────────────┐
                    │                │               │
                    │  Sidebar has   │               │
                    │  blue border   │               │
                    └────────┬───────┘               │
                             │                       │
                  j/k: Navigate conversations        │
                  g/G: First/Last                    │
                  /: Search                          │
                             │                       │
                    l or Enter pressed               │
                             │                       │
                             ▼                       │
                    ┌────────────────┐               │
                    │ DETAIL FOCUSED │               │
                    │                │               │
                    │  Detail pane   │               │
                    │  has border    │               │
                    └────────┬───────┘               │
                             │                       │
                  j/k: Navigate messages             │
                  g/G: First/Last message            │
                  u/a: Jump by role                  │
                             │                       │
                    h/Esc or Tab pressed             │
                             │                       │
                             └───────────────────────┘
```

## Vim Mode Key Mapping (Context-Aware)

```
┌─────────────────────────────────────────────────────────────────┐
│                         LIST CONTEXT                            │
├─────────────┬───────────────────────────────────────────────────┤
│ Key         │ Action                                            │
├─────────────┼───────────────────────────────────────────────────┤
│ j           │ ▼ Next conversation                               │
│ k           │ ▲ Previous conversation                           │
│ g           │ ⤒ First conversation                              │
│ G           │ ⤓ Last conversation                               │
│ l / Enter   │ ➜ Open conversation + focus detail               │
│ /           │ 🔍 Focus search box                               │
│ Tab         │ ⇆ Switch to detail pane (if open)                │
│ ?           │ ❓ Show help modal                                │
└─────────────┴───────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        DETAIL CONTEXT                           │
├─────────────┬───────────────────────────────────────────────────┤
│ Key         │ Action                                            │
├─────────────┼───────────────────────────────────────────────────┤
│ j           │ ▼ Next message turn                               │
│ k           │ ▲ Previous message turn                           │
│ g           │ ⤒ First message                                   │
│ G           │ ⤓ Last message                                    │
│ u           │ 👤 Next User message                              │
│ a           │ 🤖 Next Assistant message                         │
│ h / Esc     │ ⬅ Close detail + focus list                      │
│ Tab         │ ⇆ Switch to list pane                             │
│ ?           │ ❓ Show help modal                                │
└─────────────┴───────────────────────────────────────────────────┘
```

## Emacs Mode Key Mapping (Context-Aware)

```
┌─────────────────────────────────────────────────────────────────┐
│                         LIST CONTEXT                            │
├─────────────┬───────────────────────────────────────────────────┤
│ Key         │ Action                                            │
├─────────────┼───────────────────────────────────────────────────┤
│ Ctrl+n      │ ▼ Next conversation                               │
│ Ctrl+p      │ ▲ Previous conversation                           │
│ Alt+<       │ ⤒ First conversation                              │
│ Alt+>       │ ⤓ Last conversation                               │
│ Ctrl+f      │ ➜ Open conversation + focus detail               │
│ Ctrl+s      │ 🔍 Focus search box                               │
│ Tab/Ctrl+o  │ ⇆ Switch to detail pane (if open)                │
│ ?           │ ❓ Show help modal                                │
└─────────────┴───────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        DETAIL CONTEXT                           │
├─────────────┬───────────────────────────────────────────────────┤
│ Key         │ Action                                            │
├─────────────┼───────────────────────────────────────────────────┤
│ Ctrl+n      │ ▼ Next message turn                               │
│ Ctrl+p      │ ▲ Previous message turn                           │
│ Alt+<       │ ⤒ First message                                   │
│ Alt+>       │ ⤓ Last message                                    │
│ Alt+n       │ 👤 Next User message                              │
│ Alt+p       │ 🤖 Next Assistant message                         │
│ Ctrl+b/Esc  │ ⬅ Close detail + focus list                      │
│ Tab/Ctrl+o  │ ⇆ Switch to list pane                             │
│ ?           │ ❓ Show help modal                                │
└─────────────┴───────────────────────────────────────────────────┘
```

## Visual Focus States

### List Focused
```
╔═══════════════════════╗ ┌───────────────────────────┐
║ CONVERSATIONS         ║ │ DETAIL PANE               │
║                       ║ │                           │
║ ┏━━━━━━━━━━━━━━━━━┓  ║ │ (dimmed, no border)       │
║ ┃ Conversation 1  ┃  ║ │                           │
║ ┗━━━━━━━━━━━━━━━━━┛  ║ │ User: Hello               │
║   Conversation 2      ║ │                           │
║   Conversation 3      ║ │ Assistant: Hi there!      │
║   Conversation 4      ║ │                           │
║                       ║ │ User: How are you?        │
╚═══════════════════════╝ └───────────────────────────┘
 └─ Blue ring border         └─ Normal appearance
    └─ Selected item has
       highlighted background
```

### Detail Focused
```
┌───────────────────────┐ ╔═══════════════════════════╗
│ CONVERSATIONS         │ ║ DETAIL PANE               ║
│                       │ ║                           ║
│ (dimmed, no border)   │ ║ User: Hello               ║
│                       │ ║                           ║
│ > Conversation 1      │ ║ ┏━━━━━━━━━━━━━━━━━━━━━┓ ║
│   Conversation 2      │ ║ ┃ Assistant: Hi there!┃ ║
│   Conversation 3      │ ║ ┗━━━━━━━━━━━━━━━━━━━━━┛ ║
│   Conversation 4      │ ║                           ║
│                       │ ║ User: How are you?        ║
└───────────────────────┘ ╚═══════════════════════════╝
 └─ Normal appearance        └─ Blue ring border
                                └─ Focused message has
                                   highlighted background
```

## Navigation Example: Reading a Conversation (Vim Mode)

```
Step 1: User is in list, selects a conversation
┌────────┐
│ j j k  │ ← Navigate to conversation
└────────┘
         ↓

Step 2: Open the conversation
┌────────┐
│   l    │ ← Open (focus moves to detail)
└────────┘
         ↓

Step 3: Read through messages
┌────────┐
│ j j j  │ ← Navigate messages (auto-scrolls)
└────────┘
         ↓

Step 4: Jump to next user message
┌────────┐
│   u    │ ← Skip assistant messages
└────────┘
         ↓

Step 5: Return to conversation list
┌────────┐
│   h    │ ← Close detail (focus back to list)
└────────┘
         ↓

Step 6: Next conversation
┌────────┐
│   j    │ ← Navigate list again
└────────┘
```

## Accessibility: Focus Indicator Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    FOCUS INDICATOR LAYERS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: Pane Border (Blue 2px ring)                          │
│  ┌──────────────────────────────────────┐                      │
│  │ ╔════════════════════════════════╗   │                      │
│  │ ║ Layer 2: Selected Item BG     ║   │                      │
│  │ ║ (Blue-50 / Blue-950)          ║   │                      │
│  │ ║                                ║   │                      │
│  │ ║  Layer 3: Focus Ring          ║   │                      │
│  │ ║  ┏━━━━━━━━━━━━━━━━━━━━━━━━┓  ║   │                      │
│  │ ║  ┃ Conversation Item      ┃  ║   │                      │
│  │ ║  ┗━━━━━━━━━━━━━━━━━━━━━━━━┛  ║   │                      │
│  │ ║  (2px Blue-500 ring)          ║   │                      │
│  │ ╚════════════════════════════════╝   │                      │
│  └──────────────────────────────────────┘                      │
│                                                                 │
│  Layer 4: ARIA Live Region (Screen readers only)               │
│  "Detail pane focused. Message 3 of 12. Assistant."            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Contrast Ratios:
- Blue-500 on white: 4.5:1 ✓ (WCAG AA)
- Blue-50 on white: 1.2:1 (subtle, supplementary)
- Blue-950 on black: 1.3:1 (subtle, supplementary)
```

## Implementation Phases (Visual)

```
Phase 1: MVP
┌─────────────────────┬─────────────────────┐
│ LIST                │ DETAIL              │
│                     │                     │
│ j/k navigation ✓    │ j/k navigation ✨   │
│ Visual highlight ✓  │ Visual highlight ✨ │
│                     │ Auto-scroll ✨      │
└─────────────────────┴─────────────────────┘

Phase 2: Pane Switching
┌─────────────────────┬─────────────────────┐
│ LIST                │ DETAIL              │
│ ╔═══════════════╗   │                     │
│ ║ Tab to switch ║──→│ Tab to switch ✨    │
│ ╚═══════════════╝   │                     │
│ Blue border ✨      │ Blue border ✨      │
└─────────────────────┴─────────────────────┘

Phase 3: Advanced Nav
┌─────────────────────┬─────────────────────┐
│ LIST                │ DETAIL              │
│                     │                     │
│ g/G bounds ✓        │ g/G bounds ✨       │
│                     │ u/a role jump ✨    │
└─────────────────────┴─────────────────────┘

Phase 4: Accessibility
┌─────────────────────┬─────────────────────┐
│ LIST                │ DETAIL              │
│ aria-label ✨       │ aria-label ✨       │
│ role="navigation" ✨│ role="main" ✨      │
│ Live region ✨      │ Live region ✨      │
└─────────────────────┴─────────────────────┘
```

## Mental Model: Same Keys, Different Context

```
              ┌─────────────────────────────┐
              │   Universal Navigation      │
              │                             │
              │  j/k = Next/Previous        │
              │  g/G = First/Last           │
              │  Tab = Switch Context       │
              │  Esc = Go Back              │
              └──────────┬──────────────────┘
                         │
                         ▼
        ┌────────────────┴────────────────┐
        │                                  │
        ▼                                  ▼
┌───────────────┐                 ┌────────────────┐
│ LIST CONTEXT  │                 │ DETAIL CONTEXT │
│               │                 │                │
│ j/k =         │                 │ j/k =          │
│ conversations │                 │ messages       │
│               │                 │                │
│ u/a =         │                 │ u/a =          │
│ (unused)      │                 │ role jump      │
└───────────────┘                 └────────────────┘

         Same muscle memory, contextual behavior
```
