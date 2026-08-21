import { describe, it, expect } from 'vitest'
import { tickToStamp, stampToTick } from '../dbrain-store.js'

describe('tick ↔ timestamp mapping', () => {
  it('round-trips exactly', () => {
    for (const t of [0, 1, 287, 288, 1_000, 100_000]) {
      expect(stampToTick(tickToStamp(t))).toBe(t)
    }
  })

  it('keeps ordering within a single day', () => {
    // Regression: rounding to whole days collapsed every memory formed on the
    // same day to one timestamp, so recall lost its ordering entirely.
    expect(tickToStamp(10) < tickToStamp(200)).toBe(true)
    expect(stampToTick(tickToStamp(200))).not.toBe(stampToTick(tickToStamp(10)))
  })

  it('treats an unparseable stamp as tick zero rather than NaN', () => {
    expect(stampToTick('not a date')).toBe(0)
  })
})
