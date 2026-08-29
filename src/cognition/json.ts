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
const TASK_WORD = /\b(?:help|assist|roleplay|role-play|write|generate|create|produce|provide|engage|comply|comfortable|appropriate)\b/

export function looksLikeRefusal(text: string): boolean {
  const t = text.toLowerCase()
  if (t.includes('as an ai') || t.includes('as a language model')) return true

  const verb = t.match(REFUSAL_VERB)
  if (verb?.index == null) return false
  return TASK_WORD.test(t.slice(verb.index, verb.index + 60))
}

/**
 * Returns the outermost `{...}` in `text`, or `''` if there is none.
 * Greedy on purpose: it must span nested objects, not stop at the first `}`.
 */
export function extractJsonObject(text: string): string {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (raw.startsWith('{')) return raw
  return raw.match(/\{[\s\S]*\}/)?.[0] ?? ''
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
