import { Link } from 'react-router'
import { Keyboard, X, Settings } from 'lucide-react'
import { useSettings } from '@/contexts/SettingsContext'
import { useKeyboardNavigation } from '@/contexts/KeyboardNavigationContext'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Shortcut {
  keys: string[]
  description: string
}

// List pane shortcuts
const EMACS_LIST_SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'N'], description: 'Next conversation' },
  { keys: ['Ctrl', 'P'], description: 'Previous conversation' },
  { keys: ['Alt', '<'], description: 'First conversation' },
  { keys: ['Alt', '>'], description: 'Last conversation' },
  { keys: ['Enter'], description: 'Open & focus detail' },
  { keys: ['Ctrl', 'S'], description: 'Focus search' },
]

const VIM_LIST_SHORTCUTS: Shortcut[] = [
  { keys: ['j'], description: 'Next conversation' },
  { keys: ['k'], description: 'Previous conversation' },
  { keys: ['g'], description: 'First conversation' },
  { keys: ['G'], description: 'Last conversation' },
  { keys: ['Enter'], description: 'Open & focus detail' },
  { keys: ['/'], description: 'Focus search' },
]

// Detail pane shortcuts
const EMACS_DETAIL_SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'N'], description: 'Next message' },
  { keys: ['Ctrl', 'P'], description: 'Previous message' },
  { keys: ['Alt', '<'], description: 'First message' },
  { keys: ['Alt', '>'], description: 'Last message' },
  { keys: ['Alt', 'N'], description: 'Page down' },
  { keys: ['Alt', 'P'], description: 'Page up' },
  { keys: ['Esc'], description: 'Back to sidebar' },
]

const VIM_DETAIL_SHORTCUTS: Shortcut[] = [
  { keys: ['j'], description: 'Next message' },
  { keys: ['k'], description: 'Previous message' },
  { keys: ['g'], description: 'First message' },
  { keys: ['G'], description: 'Last message' },
  { keys: ['Ctrl', 'D'], description: 'Page down' },
  { keys: ['Ctrl', 'U'], description: 'Page up' },
  { keys: ['Esc'], description: 'Back to sidebar' },
]

// Universal shortcuts (work in both modes)
const UNIVERSAL_SHORTCUTS: Shortcut[] = [
  { keys: ['u'], description: 'Next user message' },
  { keys: ['U'], description: 'Previous user message' },
  { keys: ['a'], description: 'Next assistant message' },
  { keys: ['A'], description: 'Previous assistant message' },
  { keys: ['Tab'], description: 'Switch panes' },
]

// Arrow key shortcuts (work in both modes)
const ARROW_SHORTCUTS: Shortcut[] = [
  { keys: ['↓', '↑'], description: 'Navigate items' },
  { keys: ['→'], description: 'Open conversation' },
  { keys: ['←'], description: 'Back to sidebar' },
]

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.platform.toLowerCase().startsWith('mac')
}

function modifierKey(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl'
}

function buildGlobalShortcuts(): Shortcut[] {
  const mod = modifierKey()
  return [
    { keys: [mod, 'K'], description: 'Search in all messages' },
    { keys: [mod, 'R'], description: 'Refresh conversations' },
    { keys: ['?'], description: 'Show this help' },
  ]
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {shortcut.description}
      </span>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((key, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-zinc-400">/</span>}
            <kbd className="min-w-[1.5rem] rounded bg-zinc-100 px-1.5 py-0.5 text-center font-mono text-xs dark:bg-zinc-800">
              {key}
            </kbd>
          </span>
        ))}
      </div>
    </div>
  )
}

export function KeyboardHelpModal() {
  const { keyboardMode } = useSettings()
  const { isHelpOpen, setIsHelpOpen, focusArea } = useKeyboardNavigation()

  const listShortcuts = keyboardMode === 'vim' ? VIM_LIST_SHORTCUTS : EMACS_LIST_SHORTCUTS
  const detailShortcuts = keyboardMode === 'vim' ? VIM_DETAIL_SHORTCUTS : EMACS_DETAIL_SHORTCUTS
  const globalShortcuts = buildGlobalShortcuts()

  return (
    <Dialog open={isHelpOpen} onOpenChange={setIsHelpOpen}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
            <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {keyboardMode === 'vim' ? 'Vim Mode' : 'Emacs Mode'}
            </span>
          </DialogTitle>
          {/* Phase 2 a11y: Radix Dialog requires either DialogDescription OR
              aria-describedby={undefined} explicitly. Without one, dev mode
              emits a console warning that fails the e2e console-assertion
              fixture. Same precedent as ImageLightbox.tsx. */}
          <DialogDescription className="sr-only">
            Two-pane keyboard navigation reference. Press Esc to close.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Sidebar Navigation */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Sidebar (Conversation List)
              </h3>
              {focusArea === 'list' && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  active
                </span>
              )}
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {listShortcuts.map((shortcut, i) => (
                <ShortcutRow key={i} shortcut={shortcut} />
              ))}
            </div>
          </div>

          {/* Detail Navigation */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Detail (Messages)
              </h3>
              {focusArea === 'detail' && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  active
                </span>
              )}
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {detailShortcuts.map((shortcut, i) => (
                <ShortcutRow key={i} shortcut={shortcut} />
              ))}
            </div>
          </div>

          {/* Role-based Navigation (Detail only) */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Jump by Role (in Detail)
            </h3>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {UNIVERSAL_SHORTCUTS.map((shortcut, i) => (
                <ShortcutRow key={i} shortcut={shortcut} />
              ))}
            </div>
          </div>

          {/* Arrow Keys */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Arrow Keys (Universal)
            </h3>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {ARROW_SHORTCUTS.map((shortcut, i) => (
                <ShortcutRow key={i} shortcut={shortcut} />
              ))}
            </div>
          </div>

          {/* Global */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Global
            </h3>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {globalShortcuts.map((shortcut, i) => (
                <ShortcutRow key={i} shortcut={shortcut} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Button variant="ghost" size="sm" asChild onClick={() => setIsHelpOpen(false)}>
            <Link to="/settings" className="flex items-center gap-1">
              <Settings className="h-4 w-4" />
              Change keyboard mode
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsHelpOpen(false)}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
