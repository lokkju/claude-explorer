import { describe, it, expect, beforeEach } from 'vitest'

import {
  recordImageFailure,
  isImageFailureTombstoned,
  getImageFailureCount,
  subscribeImageFailures,
  _clearImageFailureRegistryForTests,
  DEFAULT_IMAGE_FAILURE_THRESHOLD,
} from '../../lib/imageFailureRegistry'

describe('imageFailureRegistry', () => {
  beforeEach(() => {
    _clearImageFailureRegistryForTests()
  })

  it('starts with zero failures for unseen URLs', () => {
    expect(getImageFailureCount('/api/x/files/never-seen/preview')).toBe(0)
    expect(isImageFailureTombstoned('/api/x/files/never-seen/preview')).toBe(false)
  })

  it('records failures and increments the per-URL counter', () => {
    expect(recordImageFailure('/api/cc-image?path=a.png')).toBe(1)
    expect(recordImageFailure('/api/cc-image?path=a.png')).toBe(2)
    expect(getImageFailureCount('/api/cc-image?path=a.png')).toBe(2)
    expect(getImageFailureCount('/api/cc-image?path=b.png')).toBe(0)
  })

  it('tombstones a URL once it crosses the default threshold (10)', () => {
    const url = '/api/cc-image?path=dead.png'
    for (let i = 0; i < DEFAULT_IMAGE_FAILURE_THRESHOLD - 1; i++) {
      expect(isImageFailureTombstoned(url)).toBe(false)
      recordImageFailure(url)
    }
    // 9 failures recorded; not tombstoned yet.
    expect(isImageFailureTombstoned(url)).toBe(false)
    // 10th failure trips it.
    recordImageFailure(url)
    expect(isImageFailureTombstoned(url)).toBe(true)
    // Further failures don't change tombstone state.
    recordImageFailure(url)
    expect(isImageFailureTombstoned(url)).toBe(true)
  })

  it('honors a custom threshold (lower than default)', () => {
    const url = '/api/cc-image?path=quick.png'
    expect(isImageFailureTombstoned(url, 3)).toBe(false)
    recordImageFailure(url, 3)
    recordImageFailure(url, 3)
    expect(isImageFailureTombstoned(url, 3)).toBe(false)
    recordImageFailure(url, 3)
    expect(isImageFailureTombstoned(url, 3)).toBe(true)
  })

  it('isolates URLs from each other (one failing does not tombstone another)', () => {
    const dead = '/api/cc-image?path=dead.png'
    const alive = '/api/cc-image?path=alive.png'
    for (let i = 0; i < DEFAULT_IMAGE_FAILURE_THRESHOLD; i++) {
      recordImageFailure(dead)
    }
    expect(isImageFailureTombstoned(dead)).toBe(true)
    expect(isImageFailureTombstoned(alive)).toBe(false)
  })

  it('notifies subscribers ONLY on threshold crossing (not every failure)', () => {
    const url = '/api/cc-image?path=watched.png'
    let callCount = 0
    const unsubscribe = subscribeImageFailures(() => {
      callCount += 1
    })

    // 9 failures should not trigger any notification.
    for (let i = 0; i < DEFAULT_IMAGE_FAILURE_THRESHOLD - 1; i++) {
      recordImageFailure(url)
    }
    expect(callCount).toBe(0)

    // 10th crosses the threshold — exactly one notify.
    recordImageFailure(url)
    expect(callCount).toBe(1)

    // Further failures don't re-notify.
    recordImageFailure(url)
    recordImageFailure(url)
    expect(callCount).toBe(1)

    unsubscribe()
  })

  it('unsubscribe stops further notifications', () => {
    const url = '/api/cc-image?path=unsub.png'
    let callCount = 0
    const unsubscribe = subscribeImageFailures(() => {
      callCount += 1
    })
    unsubscribe()

    for (let i = 0; i < DEFAULT_IMAGE_FAILURE_THRESHOLD; i++) {
      recordImageFailure(url)
    }
    expect(callCount).toBe(0)
  })

  it('isolates per-URL even with the same prefix (path-bust matters)', () => {
    // Same logical URL with different cache-buster suffixes are
    // treated as distinct keys. Callers (MessageBubble) deliberately
    // record/check using the BASE url (without ?retry=1) to avoid this.
    const base = '/api/cc-image?path=base.png'
    const busted = '/api/cc-image?path=base.png&retry=1'
    for (let i = 0; i < DEFAULT_IMAGE_FAILURE_THRESHOLD; i++) {
      recordImageFailure(base)
    }
    expect(isImageFailureTombstoned(base)).toBe(true)
    expect(isImageFailureTombstoned(busted)).toBe(false)
  })
})
