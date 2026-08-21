/**
 * The recording format: one run, captured tick by tick.
 *
 * This is the contract between the simulation and every viewer. The HTML debug
 * frontend and the eventual Phaser renderer both read this and nothing else, so
 * the engine never learns about presentation and a viewer never re-simulates.
 *
 * Replay has to be a recording rather than a re-run from the seed: the engine
 * is deterministic, but LLM scene resolution is not, so a re-run would produce
 * a different conversation. Full state per tick, not deltas — at these sizes it
 * costs a few MB and makes seeking trivial.
 */

export type RecordedLocation = {
  id: string
  kind: string
  name: string
  x: number
  y: number
  residentId?: string
}

export type RecordedAgent = {
  id: string
  name: string
  occupation: string
  vices: string[]
}

/** One agent at one tick. Kept terse: this is the bulk of the file. */
export type AgentFrame = {
  id: string
  /** Drawn position — interpolated along a walk, so viewers need no maths. */
  x: number
  y: number
  state: string
  /** Where they are, or their destination while walking. */
  at: string
  money: number
  arrears: number
}

export type RecordedEvent = {
  kind: string
  text: string
  /** Present on scene events. */
  dialogue?: { speaker: string; line: string }[]
  outcome?: string
  transfer?: { amount: number; from: string; to: string }
  /** Present on diary events: which traits the night moved. */
  drift?: string
}

export type Frame = {
  tick: number
  day: number
  hour: number
  minute: number
  agents: AgentFrame[]
  events: RecordedEvent[]
}

export type Recording = {
  version: 1
  city: { name: string; width: number; height: number }
  locations: RecordedLocation[]
  agents: RecordedAgent[]
  frames: Frame[]
  stats: { scenesResolved: number; spendUsd: number }
}
