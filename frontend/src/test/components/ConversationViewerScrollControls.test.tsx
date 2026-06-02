/**
 * ConversationViewerScrollControls — unit contract.
 *
 * Pins the 4 visibility branches of the sticky scroll buttons:
 *
 *   1. neither flag set            → no buttons rendered
 *   2. only `showTopButton`        → up button only
 *   3. only `showScrollButton`     → down button only
 *   4. both flags set              → both buttons rendered
 *
 * Plus: the SearchPanel-open offset (`right: 25rem` vs `right: 1.5rem`)
 * appears on the wrapping div.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationViewerScrollControls } from '../../components/conversation/ConversationViewerScrollControls'

function renderWithDefaults(overrides: Partial<{
  showScrollButton: boolean
  showTopButton: boolean
  scrollToTop: () => void
  scrollToBottom: () => void
  isSearchPanelOpen: boolean
}> = {}) {
  const props = {
    showScrollButton: false,
    showTopButton: false,
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn(),
    isSearchPanelOpen: false,
    ...overrides,
  }
  const utils = render(<ConversationViewerScrollControls {...props} />)
  return { ...utils, props }
}

describe('ConversationViewerScrollControls — visibility branches', () => {
  it('renders no buttons when both flags are false', () => {
    renderWithDefaults({ showScrollButton: false, showTopButton: false })
    expect(screen.queryByLabelText('Jump to top')).toBeNull()
    expect(screen.queryByLabelText('Jump to bottom')).toBeNull()
  })

  it('renders only the top button when showTopButton=true', () => {
    renderWithDefaults({ showScrollButton: false, showTopButton: true })
    expect(screen.getByLabelText('Jump to top')).toBeInTheDocument()
    expect(screen.queryByLabelText('Jump to bottom')).toBeNull()
  })

  it('renders only the bottom button when showScrollButton=true', () => {
    renderWithDefaults({ showScrollButton: true, showTopButton: false })
    expect(screen.queryByLabelText('Jump to top')).toBeNull()
    expect(screen.getByLabelText('Jump to bottom')).toBeInTheDocument()
  })

  it('renders both buttons when both flags are true', () => {
    renderWithDefaults({ showScrollButton: true, showTopButton: true })
    expect(screen.getByLabelText('Jump to top')).toBeInTheDocument()
    expect(screen.getByLabelText('Jump to bottom')).toBeInTheDocument()
  })
})

describe('ConversationViewerScrollControls — click wiring', () => {
  it('clicking the top button invokes scrollToTop', async () => {
    const user = userEvent.setup()
    const { props } = renderWithDefaults({ showTopButton: true })
    await user.click(screen.getByLabelText('Jump to top'))
    expect(props.scrollToTop).toHaveBeenCalledTimes(1)
  })

  it('clicking the bottom button invokes scrollToBottom', async () => {
    const user = userEvent.setup()
    const { props } = renderWithDefaults({ showScrollButton: true })
    await user.click(screen.getByLabelText('Jump to bottom'))
    expect(props.scrollToBottom).toHaveBeenCalledTimes(1)
  })
})

describe('ConversationViewerScrollControls — search-panel offset', () => {
  it('positions at right=1.5rem when search panel is closed', () => {
    const { container } = renderWithDefaults({
      showTopButton: true,
      isSearchPanelOpen: false,
    })
    const wrapper = container.querySelector('div.absolute.bottom-6') as HTMLDivElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.right).toBe('1.5rem')
  })

  it('positions at right=25rem when search panel is open', () => {
    const { container } = renderWithDefaults({
      showTopButton: true,
      isSearchPanelOpen: true,
    })
    const wrapper = container.querySelector('div.absolute.bottom-6') as HTMLDivElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.right).toBe('25rem')
  })
})
