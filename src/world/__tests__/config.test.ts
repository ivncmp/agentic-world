import { describe, it, expect, afterAll } from 'vitest'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTemplate, type CityTemplate } from '../config.js'

const dir = mkdtempSync(join(tmpdir(), 'aw-template-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let n = 0

/**
 * A template that passes every check, so each test can break exactly one thing.
 */
const valid = (): Record<string, unknown> => ({
  name: 'Testville',
  grid: { width: 25, height: 25 },
  streetPeriod: 4,
  districts: ['Centre'],
  openingsPerWorkplace: 2,
  blocks: [{ bx: 0, by: 0, role: 'civic' }],
  venues: [{ kind: 'bar', name: 'The Anchor', x: 1, y: 1, district: 'Centre' }],
  homePlots: [{ x: 2, y: 2, district: 'Centre' }],
})

const load = (t: Record<string, unknown>): CityTemplate => {
  const path = join(dir, `t-${n++}.json`)
  writeFileSync(path, JSON.stringify(t))
  return loadTemplate(path)
}

describe('loadTemplate', () => {
  it('accepts a complete template', () => {
    const t = load(valid())
    expect(t.name).toBe('Testville')
    expect(t.venues).toHaveLength(1)
  })

  it.each([
    ['name', { name: '' }, /missing name/],
    ['grid', { grid: { width: 25 } }, /grid must be/],
    ['streetPeriod', { streetPeriod: 1 }, /streetPeriod/],
    ['districts', { districts: [] }, /districts must be/],
    ['openingsPerWorkplace', { openingsPerWorkplace: 0 }, /openingsPerWorkplace/],
    ['venues', { venues: [] }, /venues must be/],
    ['homePlots', { homePlots: [] }, /homePlots must be/],
  ])('rejects a template with a bad %s', (_field, override, expected) => {
    expect(() => load({ ...valid(), ...override })).toThrow(expected)
  })

  it('rejects an unknown venue kind', () => {
    const t = valid()
    t.venues = [{ kind: 'casino', name: 'X', x: 1, y: 1, district: 'Centre' }]
    expect(() => load(t)).toThrow(/unknown venue kind "casino"/)
  })

  it('rejects a venue in a district nobody declared', () => {
    const t = valid()
    t.venues = [{ kind: 'bar', name: 'The Anchor', x: 1, y: 1, district: 'Dockside' }]
    expect(() => load(t)).toThrow(/undeclared district "Dockside"/)
  })

  it('names the offending file in the error', () => {
    expect(() => load({ ...valid(), name: '' })).toThrow(/aw-template-/)
  })
})
