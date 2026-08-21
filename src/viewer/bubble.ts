/**
 * Speech bubbles — the payoff of the whole cognition layer.
 *
 * A scene arrives as a finished transcript, not as live speech, so the bubble's
 * job is to play it back at reading pace above the two people who said it. Text
 * in the sidebar tells you a conversation happened; a bubble over their heads
 * is the conversation happening.
 */
import Phaser from 'phaser'

/**
 * How long one line stays up before the next. Short enough that a seven-line
 * scene finishes inside the time two people plausibly stand together, long
 * enough to read.
 */
const LINE_MS = 2400
const MAX_W = 190

export type Line = { speaker: string; line: string }

export class SpeechBubble {
  private readonly root: Phaser.GameObjects.Container
  private readonly bg: Phaser.GameObjects.Graphics
  private readonly text: Phaser.GameObjects.Text
  private readonly name: Phaser.GameObjects.Text

  constructor(private readonly scene: Phaser.Scene) {
    this.bg = scene.add.graphics()
    this.name = scene.add.text(0, 0, '', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '10px',
      color: '#7dd3fc',
      fontStyle: 'bold',
    })
    this.text = scene.add.text(0, 0, '', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      color: '#f1f5f9',
      wordWrap: { width: MAX_W },
      lineSpacing: 2,
    })
    this.root = scene.add.container(0, 0, [this.bg, this.name, this.text]).setVisible(false)
  }

  get container(): Phaser.GameObjects.Container {
    return this.root
  }

  show(speaker: string, line: string): void {
    this.name.setText(speaker)
    this.text.setText(line)

    const w = Math.max(this.text.width, this.name.width) + 20
    const h = this.text.height + this.name.height + 16
    this.name.setPosition(-w / 2 + 10, -h + 8)
    this.text.setPosition(-w / 2 + 10, -h + 10 + this.name.height)

    this.bg.clear()
    this.bg.fillStyle(0x0b1220, 0.92)
    this.bg.lineStyle(1, 0x334155, 1)
    this.bg.fillRoundedRect(-w / 2, -h, w, h, 8)
    this.bg.strokeRoundedRect(-w / 2, -h, w, h, 8)
    // A tail, so the bubble belongs to a person rather than hovering nearby.
    this.bg.fillTriangle(-5, -1, 5, -1, 0, 7)

    this.root.setVisible(true)
  }

  hide(): void {
    this.root.setVisible(false)
  }

  moveTo(x: number, y: number, depth: number): void {
    this.root.setPosition(x, y)
    this.root.setDepth(depth)
  }

  destroy(): void {
    this.root.destroy()
  }
}

/**
 * Plays one scene's transcript across two bubbles, one per speaker, so a
 * conversation reads as an exchange. Only one line is visible at a time —
 * two people talking over each other is noise, not drama.
 */
export class Conversation {
  private index = -1
  private elapsed = 0
  done = false

  constructor(
    readonly a: string,
    readonly b: string,
    private readonly lines: Line[],
    private readonly outcome: string | null,
  ) {}

  /** Advances the clock; returns the line to show now, or null between beats. */
  step(dt: number): { speaker: string; line: string } | null {
    if (this.done) return null
    this.elapsed += dt
    const want = Math.floor(this.elapsed / LINE_MS)
    const total = this.lines.length + (this.outcome != null ? 1 : 0)
    if (want >= total) {
      this.done = true
      return null
    }
    this.index = want
    const l = this.lines[want]
    if (l != null) return { speaker: l.speaker, line: l.line }
    return this.outcome == null ? null : { speaker: '', line: this.outcome }
  }

  get current(): number {
    return this.index
  }
}
