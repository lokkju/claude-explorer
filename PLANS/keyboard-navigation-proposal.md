# Keyboard Navigation Proposal: Two-Pane Navigation

## Executive Summary

This proposal outlines a comprehensive keyboard navigation scheme for the Claude Explorer that enables efficient navigation across both the conversation list (sidebar) and individual message turns (detail pane), supporting both Vim and Emacs keyboard modes.

## Design Team Analysis

### UX Designer 1: Accessibility & Power Users
**Specialty**: WCAG compliance, screen reader compatibility, keyboard-only workflows

### UX Designer 2: Spatial Navigation Patterns
**Specialty**: Multi-pane interfaces (Gmail, Slack, VS Code, tmux)

### UX Designer 3: Mental Models & Information Architecture
**Specialty**: Cognitive load, discoverability, error prevention

---

## Core Design Principles

1. **Consistency**: Similar actions should use similar keys across contexts
2. **Discoverability**: Navigation should be learnable and documented
3. **Accessibility**: Full keyboard support with proper focus management and ARIA
4. **Efficiency**: Power users should be able to navigate rapidly
5. **Safety**: Easy recovery from mistakes, clear visual feedback

---

## Recommended Navigation Model: **Spatial with Contextual Scope**

After analyzing Gmail, Slack, VS Code splits, and tmux, I recommend a **spatial model** where:

- The two panes are conceptually "left" (list) and "right" (detail)
- Navigation keys have **contextual scope** based on which pane has focus
- The same keys (j/k, Ctrl+N/P) work in both panes but operate on different targets
- Explicit pane-switching uses dedicated keys
- Visual feedback clearly shows which pane is active

### Why This Model?

✅ **Mental Model Clarity**: Users understand "I'm navigating the list" vs "I'm navigating the messages"
✅ **Muscle Memory**: Same keys work in both contexts (j/k always means "next/previous")
✅ **Accessibility**: Clear focus indicators and ARIA labels describe current context
✅ **Established Pattern**: Matches Gmail (conversation list vs message thread), VS Code (sidebar vs editor)

---

## Detailed Key Bindings

### Universal Keys (Both Modes)

These keys work identically in Vim and Emacs modes because they represent universal UI concepts:

| Key | Action | Rationale |
|-----|--------|-----------|
| `Enter` | Open conversation AND move focus to detail | Universal "activate/confirm" |
| `Escape` | Return focus to sidebar | Universal "back/exit context" |
| `Tab` | Switch focus between panes | Standard accessibility pattern |
| `?` | Show keyboard shortcuts | ✓ Existing |
| `u` | Jump to next User message | Mnemonic: "u" for user |
| `a` | Jump to next Assistant message | Mnemonic: "a" for assistant |
| `U` | Jump to previous User message | Shift = reverse direction |
| `A` | Jump to previous Assistant message | Shift = reverse direction |

### Vim Mode

#### When Focus is on **List** (Sidebar)

| Key | Action | Notes |
|-----|--------|-------|
| `j` | Next conversation | ✓ Existing |
| `k` | Previous conversation | ✓ Existing |
| `g` | First conversation | ✓ Existing |
| `G` | Last conversation | ✓ Existing |
| `Enter` | Open conversation + focus detail | ✓ Universal |
| `/` | Focus search input | ✓ Existing |

#### When Focus is on **Detail** (Message Pane)

| Key | Action | Notes |
|-----|--------|-------|
| `j` | Next message turn | ✨ New: contextual scope |
| `k` | Previous message turn | ✨ New |
| `g` | First message | ✨ New |
| `G` | Last message | ✨ New |
| `Ctrl+d` | Page down (half screen) | Standard Vim |
| `Ctrl+u` | Page up (half screen) | Standard Vim |
| `u` / `U` | Next/Previous User message | ✨ Universal |
| `a` / `A` | Next/Previous Assistant message | ✨ Universal |
| `Escape` | Return focus to sidebar | ✓ Universal |

### Emacs Mode

#### When Focus is on **List** (Sidebar)

| Key | Action | Notes |
|-----|--------|-------|
| `Ctrl+n` | Next conversation | ✓ Existing |
| `Ctrl+p` | Previous conversation | ✓ Existing |
| `Alt+<` | First conversation | ✨ New (standard Emacs) |
| `Alt+>` | Last conversation | ✨ New (standard Emacs) |
| `Enter` | Open conversation + focus detail | ✓ Universal |
| `Ctrl+s` | Focus search input | ✓ Existing |

#### When Focus is on **Detail** (Message Pane)

| Key | Action | Notes |
|-----|--------|-------|
| `Ctrl+n` | Next message turn | ✨ New: contextual scope |
| `Ctrl+p` | Previous message turn | ✨ New |
| `Alt+<` | First message | ✨ New |
| `Alt+>` | Last message | ✨ New |
| `Alt+n` | Page down | Meta = bigger movement |
| `Alt+p` | Page up | Meta = bigger movement |
| `u` / `U` | Next/Previous User message | ✨ Universal |
| `a` / `A` | Next/Previous Assistant message | ✨ Universal |
| `Escape` | Return focus to sidebar | ✓ Universal |

---

## Key Design Decisions

### 1. Reuse j/k and Ctrl+N/P in Both Contexts ✅

**Rationale**:
- Matches mental model: "next/previous" is contextual
- Reduces cognitive load (fewer keys to remember)
- Mirrors Gmail, Slack patterns
- Visual focus indicator prevents confusion

**Alternative Considered**: Use different keys (n/p in detail)
**Rejected Because**: More keys to learn, breaks muscle memory

### 2. Tab for Pane Switching ✅

**Rationale**:
- Standard accessibility pattern (Tab moves between major regions)
- Works with screen readers (ARIA landmarks)
- Familiar to keyboard-only users
- Can be combined with Ctrl+O as alternative (Emacs users might prefer)

**Conflict Resolution**: Tab won't work for interactive elements *within* messages (buttons, links). Solution:
- Messages are read-only in this app (no interactive elements currently)
- If interactive elements are added later, use `F6` for pane switching (WCAG pattern)

### 3. Visual Focus Indicators (Essential) ✅

**Implementation**:
1. **Active Pane**: 2px colored border (blue-500) around pane
2. **Focused Item**: Background highlight on current conversation/message
3. **Focus Ring**: Standard browser focus ring on keyboard-navigated items
4. **ARIA Live Region**: Announce "List focus" / "Detail focus" to screen readers

**Example**:
```
┌─────────────────────┬────────────────────────────┐
│ [SIDEBAR]           │ [DETAIL - FOCUSED]         │
│                     │ ╔══════════════════════════╗│
│ > Conversation 1    │ ║ User: Hello              ║│
│   Conversation 2    │ ║                          ║│
│   Conversation 3    │ ╚══════════════════════════╝│
│                     │                             │
│                     │ > Assistant: Hi there!     │ <- Current message
│                     │                             │
│                     │   User: How are you?       │
└─────────────────────┴────────────────────────────┘
         └─ Dimmed               └─ Blue border
```

### 4. Auto-Scroll Coupling ✅

**Behavior**: Keyboard navigation ALWAYS scrolls focused item into view
- Uses `scrollIntoView({ behavior: 'smooth', block: 'center' })`
- Ensures focused message is vertically centered when possible
- Preserves scroll position when switching panes

**Rationale**: Keyboard navigation is about precision—users expect to see what they've focused.

### 5. Role-Based Navigation (u/a/U/A for User/Assistant) ✅

**Why**: Long conversations benefit from jumping between speakers
- `u`: Jump to next User message
- `a`: Jump to next Assistant message
- `U`: Jump to previous User message (Shift = reverse)
- `A`: Jump to previous Assistant message (Shift = reverse)

**Design Pattern**: Follows Vim convention where lowercase = forward, uppercase = backward (like `n/N` for search matches)

**Alternative Considered**: Use numbers (1-9 to jump to message N)
**Rejected Because**: Messages aren't numbered visually; role-based is more intuitive

### 6. Universal Enter/Escape Keys ✅

**Rationale**:
- `Enter` is semantically "activate/confirm" — not a Vim or Emacs concept, but a universal UI concept
- `Escape` is semantically "back/exit context" — matches browsers, modals, and hierarchical navigation everywhere
- These aren't text editing conventions, they're spatial navigation concepts

**Benefit**: Users don't need to remember different keys for fundamental actions based on mode

### 7. Paging (Ctrl+D/U for Vim, M-n/M-p for Emacs) ✅

**Vim Mode**: `Ctrl+d` / `Ctrl+u` for half-page down/up (standard Vim)
**Emacs Mode**: `Alt+n` / `Alt+p` for page down/up (Meta = "bigger" version of C-n/C-p)

**Rationale**: Long conversations need fast scrolling beyond line-by-line navigation

---

## Context State Management

### Updated KeyboardNavigationContext

Add to existing context:

```typescript
export type FocusArea = 'list' | 'detail' | 'none'

interface KeyboardNavigationContextType {
  // Existing: List navigation
  selectedIndex: number
  conversationIds: string[]

  // NEW: Detail navigation
  selectedMessageIndex: number
  setSelectedMessageIndex: (index: number) => void
  messageIds: string[]  // UUIDs of messages in current conversation
  setMessageIds: (ids: string[]) => void

  // NEW: Detail navigation helpers
  selectNextMessage: () => void
  selectPreviousMessage: () => void
  selectFirstMessage: () => void
  selectLastMessage: () => void
  selectNextUserMessage: () => void
  selectNextAssistantMessage: () => void
  getSelectedMessageId: () => string | null

  // Existing: Focus management
  focusArea: FocusArea
  setFocusArea: (area: FocusArea) => void

  // Existing: Help modal
  isHelpOpen: boolean
  setIsHelpOpen: (open: boolean) => void
}
```

### Focus Transition Rules

```typescript
// Opening a conversation
onOpenConversation() {
  navigate(`/conversations/${id}`)
  setFocusArea('detail')  // Auto-focus detail pane
  setSelectedMessageIndex(0)  // Focus first message
}

// Closing detail
onCloseDetail() {
  navigate('/conversations')
  setFocusArea('list')  // Return focus to list
}

// Tab key
onTabPressed() {
  if (focusArea === 'list' && currentConversationOpen) {
    setFocusArea('detail')
  } else if (focusArea === 'detail') {
    setFocusArea('list')
  }
}
```

---

## Visual Feedback Implementation

### 1. Pane Borders

```tsx
// Sidebar
<aside className={cn(
  "border-r transition-all",
  focusArea === 'list'
    ? "ring-2 ring-blue-500 ring-inset"
    : ""
)}>
  {/* ... */}
</aside>

// Detail
<main className={cn(
  "flex-1 transition-all",
  focusArea === 'detail'
    ? "ring-2 ring-blue-500 ring-inset"
    : ""
)}>
  {/* ... */}
</main>
```

### 2. Message Highlighting

```tsx
<div
  data-message-uuid={message.uuid}
  className={cn(
    "message-bubble",
    selectedMessageId === message.uuid && focusArea === 'detail'
      ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950"
      : ""
  )}
  tabIndex={focusArea === 'detail' && selectedMessageId === message.uuid ? 0 : -1}
  role="article"
  aria-label={`${message.sender} message`}
>
  {/* ... */}
</div>
```

### 3. ARIA Live Region

```tsx
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {focusArea === 'list' && 'Conversation list focused'}
  {focusArea === 'detail' && 'Message detail focused'}
</div>
```

---

## Accessibility Checklist

- [ ] **WCAG 2.1 Level AA**: All functionality available via keyboard
- [ ] **Focus Visible**: Clear visual indicator (ring-2 ring-blue-500)
- [ ] **Focus Order**: Logical tab order through interface
- [ ] **Semantic HTML**: Use `<nav>`, `<main>`, `<article>` for regions
- [ ] **ARIA Landmarks**: `role="navigation"` on sidebar, `role="main"` on detail
- [ ] **ARIA Labels**: `aria-label` describes current focus ("Conversation 1 of 50")
- [ ] **ARIA Live Regions**: Announce focus changes to screen readers
- [ ] **Skip Links**: "Skip to detail pane" link for screen readers
- [ ] **Keyboard Trap Prevention**: Escape always exits modal/detail
- [ ] **Contrast Ratios**: Focus indicators meet 3:1 minimum

---

## Discoverability: Help Modal Updates

Update the existing `?` help modal to show context-aware shortcuts:

```tsx
<KeyboardHelpModal>
  <section>
    <h3>Navigation</h3>
    {focusArea === 'list' ? (
      <>
        <kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> - Next/Previous conversation
        <kbd>g</kbd>/<kbd>G</kbd> - First/Last conversation
        <kbd>l</kbd> or <kbd>Enter</kbd> - Open conversation
        <kbd>Tab</kbd> - Switch to detail pane
      </>
    ) : (
      <>
        <kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> - Next/Previous message
        <kbd>g</kbd>/<kbd>G</kbd> - First/Last message
        <kbd>u</kbd>/<kbd>a</kbd> - Jump to User/Assistant message
        <kbd>h</kbd> or <kbd>Esc</kbd> - Return to list
        <kbd>Tab</kbd> - Switch to list pane
      </>
    )}
  </section>
</KeyboardHelpModal>
```

---

## Edge Cases

### Empty Conversation List
- j/k do nothing (no navigation possible)
- Help modal still accessible with `?`

### Single Message Conversation
- j/k do nothing (already at first/last)
- g/G do nothing (already at boundaries)
- Visual feedback shows "1 of 1 message"

### Highlighted Search Results
- Existing `highlight` param still works
- Opening a conversation from search auto-scrolls to highlighted message
- Keyboard navigation starts from highlighted message (not first message)

### Long Conversations
- Virtual scrolling considered but NOT implemented initially (premature optimization)
- Auto-scroll ensures focused message is always visible
- Jump-to-bottom button remains independent of keyboard nav

---

## Implementation Plan

### Phase 1: Core Message Navigation (MVP)
1. Add message selection state to KeyboardNavigationContext
2. Implement j/k (Vim) and Ctrl+N/P (Emacs) in detail pane
3. Add visual highlighting for focused message
4. Auto-scroll focused message into view

### Phase 2: Pane Switching
1. Implement Tab key for pane switching
2. Add pane border focus indicators
3. Update focus state on l/Enter and h/Escape

### Phase 3: Advanced Navigation
1. Implement g/G for first/last message
2. Add u/a for role-based navigation (User/Assistant)
3. Update help modal with context-aware shortcuts

### Phase 4: Accessibility Polish
1. Add ARIA labels and live regions
2. Test with screen readers (VoiceOver, NVDA)
3. Verify WCAG 2.1 Level AA compliance
4. Add skip links

### Phase 5: Testing & Refinement
1. E2E tests for keyboard navigation
2. User testing with keyboard-only workflows
3. Performance testing with large conversations (1000+ messages)

---

## Open Questions for User Feedback

1. **Arrow Keys**: Should ↓/↑ also work in addition to j/k and Ctrl+N/P? (More discoverable but conflicts with scroll)
2. **Page Jump**: Should Page Up/Down jump by screenfuls of messages? (Vim-style ^U/^D)
3. **Search Integration**: Should `/` search within the current conversation when detail is focused?
4. **Bookmarks**: Should there be a way to "mark" important messages and jump to them?

---

## Comparison to Existing Patterns

### Gmail
- ✅ j/k for next/previous in both thread list and conversation view
- ✅ Auto-collapse thread list when conversation opens
- ❌ No explicit pane switching (single-pane mobile-first design)

### Slack
- ✅ ↑/↓ for channel list, separate navigation in message pane
- ✅ Ctrl+K for quick switcher (we have Ctrl+K for command palette)
- ❌ Complex focus management with composer, reactions, threads

### VS Code
- ✅ Ctrl+0/1/2 to focus sidebar/editor groups
- ✅ Ctrl+B to toggle sidebar visibility
- ❌ Too many panes/views for our simpler use case

### tmux
- ✅ Ctrl+B + arrow keys for pane switching
- ✅ Explicit pane selection model
- ❌ Too modal/complex for GUI app

**Our Approach**: Hybrid of Gmail (contextual keys) + VS Code (Tab for pane switching) + clear visual feedback

---

## Success Metrics

- **Keyboard-only users can navigate entire app**: 100% coverage
- **Time to navigate to specific message**: <3 seconds for power users
- **Discoverability**: 80% of users can find keyboard shortcuts within 2 minutes
- **Accessibility**: Zero WCAG Level AA violations
- **User satisfaction**: 90%+ positive feedback from keyboard-only users

---

## Conclusion

This proposal provides a comprehensive, accessible, and efficient keyboard navigation system that:

1. ✅ Enables navigation of both conversation list and message turns
2. ✅ Provides clear focus management with visual feedback
3. ✅ Works naturally in both Vim and Emacs modes
4. ✅ Follows established UX patterns (Gmail, VS Code)
5. ✅ Meets WCAG 2.1 Level AA accessibility standards
6. ✅ Supports power-user efficiency with role-based jumps
7. ✅ Remains discoverable for new users via help modal

The spatial model with contextual scope provides the best balance of mental model clarity, muscle memory efficiency, and accessibility compliance.
