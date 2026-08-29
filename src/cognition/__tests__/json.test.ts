import { describe, it, expect } from 'vitest'
import { extractJsonObject, looksLikeRefusal, parseJsonResponse } from '../json.js'

describe('extractJsonObject', () => {
  it('returns a bare object unchanged', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}')
  })

  it('unwraps a ```json fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('skips preamble prose', () => {
    expect(extractJsonObject('Here you go:\n{"a":1}')).toBe('{"a":1}')
  })

  it('stops at the matching brace, not the last one in the text', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```\nThe empty object {} is separate.')).toBe('{"a":1}')
  })

  it('spans nested objects', () => {
    expect(extractJsonObject('```json\n{"a":{"b":2}}\n```\nDone.')).toBe('{"a":{"b":2}}')
  })

  it('ignores braces inside string values', () => {
    expect(extractJsonObject('{"line":"he said {nope}"}')).toBe('{"line":"he said {nope}"}')
  })

  it('ignores an escaped quote inside a string value', () => {
    const raw = '{"line":"she said \\"hi\\" and left"}'
    expect(extractJsonObject(raw)).toBe(raw)
  })

  it('returns empty for a truncated object', () => {
    expect(extractJsonObject('{"a":1, "b":')).toBe('')
  })

  it('returns empty when there is no object at all', () => {
    expect(extractJsonObject('I have nothing for you.')).toBe('')
  })
})

describe('looksLikeRefusal', () => {
  it('spots a model declining the task', () => {
    expect(looksLikeRefusal("I appreciate the prompt, but I'm not comfortable roleplaying that.")).toBe(true)
    expect(looksLikeRefusal('As an AI assistant, I cannot help with this.')).toBe(true)
  })

  it('does not mistake a character in distress for a refusal', () => {
    expect(looksLikeRefusal("I can't take this anymore.")).toBe(false)
    expect(looksLikeRefusal("I won't let him see me like this.")).toBe(false)
  })
})

describe('parseJsonResponse', () => {
  it('parses a fenced response with trailing prose', () => {
    expect(parseJsonResponse('scene', '```json\n{"ok":true}\n```\nHope that helps.')).toEqual({ ok: true })
  })

  it('names the route and reports a refusal as such', () => {
    expect(() => parseJsonResponse('crisis', "I'm not comfortable writing that.")).toThrow(
      /crisis response refused/,
    )
  })

  it('distinguishes malformed output from a refusal', () => {
    expect(() => parseJsonResponse('scene', 'no object here')).toThrow(
      /scene response contained no JSON object/,
    )
  })
})
