/**
 * JSON response helpers. The engine speaks nothing else.
 */
import type { ServerResponse } from 'node:http'

/**
 * The only response shape this server produces.
 */
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * An error with a chosen status.
 */
export function fail(res: ServerResponse, status: number, error: string): void {
  json(res, status, { error })
}

/**
 * Turn a thrown value into a 400 with a readable message. A thrown value
 * turned into a 400 with a readable message.
 */
export function failFrom(res: ServerResponse, err: unknown): void {
  fail(res, 400, err instanceof Error ? err.message : String(err))
}

/**
 * Collect a request body, then hand it to a handler. Collects a request body,
 * then hands it to a handler.
 */
export function withBody(req: NodeJS.ReadableStream, handler: (body: string) => Promise<void>): void {
  let body = ''
  req.on('data', (c: Buffer) => {
    body += c.toString()
  })
  req.on('end', () => void handler(body))
}

/**
 * Two decimals. Relationship numbers are noise below that and read badly.
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100
