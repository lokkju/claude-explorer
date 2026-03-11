import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import type { Message, ContentBlock } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date

  if (isToday(d)) {
    return format(d, 'h:mm a')
  }
  if (isYesterday(d)) {
    return 'Yesterday'
  }
  return format(d, 'MMM d')
}

export function formatMessageTimestamp(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date

  if (isToday(d)) {
    return format(d, 'h:mm:ss a')
  }
  if (isYesterday(d)) {
    return 'Yesterday ' + format(d, 'h:mm:ss a')
  }
  return format(d, 'MMM d, yyyy h:mm:ss a')
}

export function formatRelativeDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function formatFullDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'PPpp')
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 100)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Remove tool placeholder blocks from markdown text
function filterToolPlaceholders(text: string): string {
  // Match code blocks containing the Claude Desktop placeholder (with optional whitespace)
  const pattern = /```\s*\n?\s*This block is not supported on your current device yet\.\s*\n?\s*```/g
  return text.replace(pattern, '').replace(/\n{3,}/g, '\n\n')
}

function contentBlockToMarkdown(block: ContentBlock, showToolCalls: boolean): string {
  switch (block.type) {
    case 'text':
      return block.text || ''
    case 'tool_use':
      if (!showToolCalls) return ''
      return `\n\n<details>\n<summary>Tool: ${block.name}</summary>\n\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n</details>\n`
    case 'tool_result':
      if (!showToolCalls) return ''
      const textContent = (block.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      return `\n\n<details>\n<summary>Tool Result</summary>\n\n\`\`\`\n${textContent}\n\`\`\`\n</details>\n`
    default:
      return ''
  }
}

export function messageToMarkdown(message: Message, showToolCalls: boolean): string {
  const sender = message.sender === 'human' ? 'You' : 'Claude'
  let content = ''

  if (message.content && message.content.length > 0) {
    content = message.content
      .map((block) => contentBlockToMarkdown(block, showToolCalls))
      .join('')
  } else {
    content = message.text
  }

  // Filter out tool placeholders if showToolCalls is false
  if (!showToolCalls) {
    content = filterToolPlaceholders(content)
  }

  return `**${sender}:**\n\n${content.trim()}`
}

export function conversationToMarkdown(
  title: string,
  messages: Message[],
  showToolCalls: boolean
): string {
  const header = `# ${title}\n\n`
  const body = messages
    .map((msg) => messageToMarkdown(msg, showToolCalls))
    .join('\n\n---\n\n')
  return header + body
}