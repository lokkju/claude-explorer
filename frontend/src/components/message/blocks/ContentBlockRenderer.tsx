import type { ContentBlock } from '@/lib/types'
import type { CcImageEntries } from './imageCollection'
import { ToolUseBlock, ToolResultBlock } from './ToolBlocks'
import { CcImageMarkerText, InlineImageBlock } from './ImageBlocks'

interface ContentBlockListProps {
  content: ContentBlock[]
  showToolCalls: boolean
  expandAll?: boolean
  ccImageEntries: CcImageEntries
  onOpenCcImage: (index: number) => void
  searchQuery?: string
}

/**
 * Renders an ordered list of message content blocks. Thin pass-through:
 * threads each block + its block index into `ContentBlockRenderer`,
 * which is the discriminated switch over the block type.
 */
export function ContentBlockList({
  content,
  showToolCalls,
  expandAll,
  ccImageEntries,
  onOpenCcImage,
  searchQuery,
}: ContentBlockListProps) {
  return (
    <>
      {content.map((block, index) => (
        <ContentBlockRenderer
          key={index}
          block={block}
          blockIndex={index}
          showToolCalls={showToolCalls}
          expandAll={expandAll}
          ccImageEntries={ccImageEntries}
          onOpenCcImage={onOpenCcImage}
          searchQuery={searchQuery}
        />
      ))}
    </>
  )
}

interface ContentBlockRendererProps {
  block: ContentBlock
  blockIndex: number
  showToolCalls: boolean
  expandAll?: boolean
  ccImageEntries: CcImageEntries
  onOpenCcImage: (index: number) => void
  searchQuery?: string
}

/**
 * Discriminated switch over `ContentBlock.type`.
 *
 * Note `ContentBlock.type` is closed on the TS side (`'text' |
 * 'tool_use' | 'tool_result' | 'image' | 'thinking'`) while open on the
 * backend side (`str`) — see lib/types.ts:120-129. The `default` arm
 * therefore must `return null` for forward-compat with new Anthropic
 * block types.
 */
export function ContentBlockRenderer({
  block,
  blockIndex,
  showToolCalls,
  expandAll,
  ccImageEntries,
  onOpenCcImage,
  searchQuery,
}: ContentBlockRendererProps) {
  switch (block.type) {
    case 'text':
      return (
        <CcImageMarkerText
          content={block.text || ''}
          showToolCalls={showToolCalls}
          startCcIndex={ccImageEntries.blockOffsets[blockIndex] ?? 0}
          onOpenCcImage={onOpenCcImage}
          searchQuery={searchQuery}
        />
      )
    case 'tool_use':
      return showToolCalls ? (
        <ToolUseBlock name={block.name || ''} input={block.input} forceExpanded={expandAll} />
      ) : null
    case 'tool_result':
      return showToolCalls ? (
        <ToolResultBlock content={block.content || []} forceExpanded={expandAll} />
      ) : null
    case 'image': {
      // Claude Code embeds images as inline content blocks of shape
      // { type: 'image', source: { type: 'base64', media_type: '...', data: '...' } }
      // alongside a sibling text block carrying the "[Image #N]"
      // marker. Click opens the in-page lightbox (Issue #1).
      const ccIndex = ccImageEntries.blockOffsets[blockIndex] ?? 0
      return (
        <InlineImageBlock
          source={block.source}
          onOpen={() => onOpenCcImage(ccIndex)}
        />
      )
    }
    default:
      return null
  }
}
