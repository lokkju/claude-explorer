import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Sun, Moon, Monitor, Settings, Keyboard, Database, Info, ExternalLink, FileText } from 'lucide-react'
import {
  useSettings,
  isTheme,
  isKeyboardMode,
  isMarkdownDialect,
} from '@/contexts/SettingsContext'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useConfig, useConfigStats } from '@/hooks/useConversations'

export function SettingsPage() {
  const {
    theme,
    setTheme,
    keyboardMode,
    setKeyboardMode,
    markdownBundleImages,
    setMarkdownBundleImages,
    markdownDialect,
    setMarkdownDialect,
  } = useSettings()
  // V1 polish 2026-05-24 (Bug 2) — the previous
  // `export.includeCompactContent` pref + checkbox was REMOVED. The
  // conversation header's "Show Compactions" checkbox now drives BOTH
  // viewer visibility AND export inclusion (single source of truth).
  const navigate = useNavigate()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        navigate(-1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
  // /config is fast (no directory walk) and used everywhere; the slow
  // /config/stats variant populates conversation_count and is fetched
  // only here on the Settings page where the user is willing to wait.
  //
  // 2026-05-23 (perf — React Query duplicate-fetch fix): switched from
  // inline `useQuery({ queryKey: ['config'] })` to the shared
  // `useConfig()` / `useConfigStats()` hooks. The inline-vs-hook split
  // meant SettingsPage AND ConfigCorruptionBanner each subscribed to
  // ['config'] separately. React Query's queryKey-based dedup happens
  // to handle this correctly (identical key shape → shared observer),
  // but the inline form was brittle to any future rename of
  // queryKeys.config. Single source of truth via the hook eliminates
  // the foot-gun.
  //
  // Hunt #5 (2026-05-18): dropped `staleTime: Infinity` to inherit the
  // queryClient default (30s). The previous inline `Infinity` used to
  // OVERRIDE the useConfigStats hook's TTL per-observer; the hook form
  // now ensures lockstep.
  const { data: config } = useConfig()
  const { data: stats } = useConfigStats()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6">
        <header className="mb-8">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            <Settings className="h-6 w-6" />
            Settings
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Customize your Claude Explorer experience
          </p>
        </header>

        <div className="space-y-8">
          {/* Theme Section */}
          <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              <Sun className="h-5 w-5" />
              Appearance
            </h2>
            <div className="space-y-3">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Theme
              </label>
              <RadioGroup
                value={theme}
                onValueChange={(value) => {
                  // Radix hands us a `string`; only accept values in the
                  // Theme union. Unknown values (corrupted persisted
                  // state, future Radix change) are silently rejected.
                  if (isTheme(value)) setTheme(value)
                }}
                className="grid grid-cols-3 gap-3"
              >
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors ${
                    theme === 'light'
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                  }`}
                >
                  <RadioGroupItem value="light" id="light" />
                  <Sun className="h-4 w-4" />
                  <span className="text-sm text-zinc-900 dark:text-zinc-100">Light</span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors ${
                    theme === 'dark'
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                  }`}
                >
                  <RadioGroupItem value="dark" id="dark" />
                  <Moon className="h-4 w-4" />
                  <span className="text-sm text-zinc-900 dark:text-zinc-100">Dark</span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors ${
                    theme === 'system'
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                  }`}
                >
                  <RadioGroupItem value="system" id="system" />
                  <Monitor className="h-4 w-4" />
                  <span className="text-sm text-zinc-900 dark:text-zinc-100">System</span>
                </label>
              </RadioGroup>
            </div>
          </section>

          {/* Keyboard Navigation Section */}
          <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              <Keyboard className="h-5 w-5" />
              Keyboard Navigation
            </h2>
            <div className="space-y-3">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Keyboard Mode
              </label>
              <RadioGroup
                value={keyboardMode}
                onValueChange={(value) => {
                  if (isKeyboardMode(value)) setKeyboardMode(value)
                }}
                className="grid grid-cols-2 gap-3"
              >
                <label
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                    keyboardMode === 'emacs'
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="emacs" id="emacs" />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Emacs</span>
                  </div>
                  <span className="ml-6 text-xs text-zinc-500 dark:text-zinc-400">
                    Ctrl+N/P, Ctrl+F/B, Ctrl+S
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                    keyboardMode === 'vim'
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="vim" id="vim" />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Vim</span>
                  </div>
                  <span className="ml-6 text-xs text-zinc-500 dark:text-zinc-400">
                    j/k, l/h, /, gg/G
                  </span>
                </label>
              </RadioGroup>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Press <kbd className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800">?</kbd> anywhere to see all keyboard shortcuts
              </p>
            </div>
          </section>

          {/* Export Section (Markdown + PDF) */}
          <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800" data-section="markdown-export">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              <FileText className="h-5 w-5" />
              Export
            </h2>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={markdownBundleImages}
                  onChange={(e) => setMarkdownBundleImages(e.target.checked)}
                  className="mt-1 h-4 w-4 cursor-pointer rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600"
                  data-testid="settings-markdown-bundle-images"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Bundle images as a zip
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Export the conversation as a zip with <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">conversation.md</code> plus an <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">images/</code> directory and relative refs, so the file works without the local backend running. Bundles Claude Code images (inline + on-disk markers); Desktop attachments still resolve via the API URL.
                  </p>
                </div>
              </label>

              <div>
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Markdown dialect
                </label>
                <p className="mt-0.5 mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Pick the image-ref syntax for the bundled <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">conversation.md</code>. CommonMark works in GitHub, MacDown, and Obsidian. Obsidian wikilinks render as inline previews in Obsidian itself.
                </p>
                <RadioGroup
                  value={markdownDialect}
                  onValueChange={(value) => {
                    if (isMarkdownDialect(value)) setMarkdownDialect(value)
                  }}
                  className="grid grid-cols-2 gap-3"
                >
                  <label
                    className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                      markdownDialect === 'commonmark'
                        ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                        : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="commonmark" id="commonmark" />
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">CommonMark</span>
                    </div>
                    <span className="ml-6 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      ![alt](images/x.png)
                    </span>
                  </label>
                  <label
                    className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                      markdownDialect === 'obsidian'
                        ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                        : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="obsidian" id="obsidian" />
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Obsidian</span>
                    </div>
                    <span className="ml-6 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      ![[images/x.png]]
                    </span>
                  </label>
                </RadioGroup>
              </div>
            </div>
          </section>

          {/* Data Section */}
          <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              <Database className="h-5 w-5" />
              Data
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Data Directory
                </label>
                <p className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
                  {config?.data_dir || 'Loading...'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Total Conversations
                </label>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {stats?.conversation_count !== undefined ? stats.conversation_count.toLocaleString() : 'Loading...'}
                </p>
              </div>
            </div>
          </section>

          {/* About Section */}
          <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              <Info className="h-5 w-5" />
              About
            </h2>
            <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <p>
                <strong className="text-zinc-900 dark:text-zinc-100">Claude Explorer</strong> - Browse and export your Claude conversations
              </p>
              <a
                href="https://github.com/anthropics/claude-explorer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
