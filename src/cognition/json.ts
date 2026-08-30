/**
 * Pulling the JSON object out of a model response.
 *
 * Every route asks for "ONLY a JSON object" and every model answers differently:
 * bare, wrapped in a ```json fence, or with a sentence of preamble. Each route
 * used to reimplement the extraction, so a model that changed its habits broke
 * them one at a time.
 */

/**
 * A model declining the task, as opposed to a character in distress.
 *
 * The distinction is what the refusal verb governs: "I can't take this anymore"
 * is exactly the kind of thought a crisis is supposed to produce, while "I'm not
 * comfortable roleplaying that" is the model talking. So the verb only counts
 * when a task word follows it closely.
 */
const REFUSAL_VERB = /\bi(?:'m| am)?\s*(?:can(?:no|')?t|won'?t|am not|'m not|do not|don'?t)\b/
const TASK_WORD =
  /\b(?:help|assist|roleplay|role-play|write|generate|create|produce|provide|engage|comply|comfortable|appropriate)\b/

/**
 * True when the model declined the task rather than answered it.
 */
export function looksLikeRefusal(text: string): boolean {
  const t = text.toLowerCase()
  if (t.includes('as an ai') || t.includes('as a language model')) return true

  const verb = t.match(REFUSAL_VERB)
  if (verb?.index == null) return false
  return TASK_WORD.test(t.slice(verb.index, verb.index + 60))
}

/**
 * Returns the first complete `{...}` in `text`, or `''` if there is none.
 *
 * Brace-matched rather than pattern-matched. A regex has to choose between
 * stopping at the first `}` (which truncates any nested object) and running to
 * the last one (which swallows a closing ``` fence, or a stray brace in a
 * trailing sentence). Counting depth while skipping over string literals is the
 * only version that survives every shape a model actually returns.
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start < 0) return ''

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const c = text[i]!

    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }

    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }

  return '' // unterminated — a truncated response
}

/**
 * Parses a route's JSON response, or throws with enough of the offending text
 * to tell a refusal apart from a malformed answer in the logs.
 */
export function parseJsonResponse<T>(route: string, text: string): T {
  const json = extractJsonObject(text)
  if (json === '') {
    const why = looksLikeRefusal(text) ? 'refused' : 'contained no JSON object'
    throw new Error(`${route} response ${why}: ${text.trim().slice(0, 120)}`)
  }
  return JSON.parse(json) as T
}

/**
 * A model-supplied value, usable only if it really is a string.
 *
 * `String(x)` turns an object into "[object Object]", which then sails through
 * validation as a plausible-looking name. Every field a route reads out of a
 * parsed response goes through here instead.
 */
export function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
