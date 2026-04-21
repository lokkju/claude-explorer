import { useQuery } from '@tanstack/react-query'
import { Sun, Moon, Monitor, Settings, Keyboard, Database, Info, ExternalLink } from 'lucide-react'
import { useSettings, type Theme, type KeyboardMode } from '@/contexts/SettingsContext'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api } from '@/lib/api'

export function SettingsPage() {
  const { theme, setTheme, keyboardMode, setKeyboardMode } = useSettings()
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
  })

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
                onValueChange={(value) => setTheme(value as Theme)}
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
                onValueChange={(value) => setKeyboardMode(value as KeyboardMode)}
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
                  {config?.conversation_count !== undefined ? config.conversation_count.toLocaleString() : 'Loading...'}
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
                href="https://github.com/anthropics/claude-desktop-message-exporter"
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
