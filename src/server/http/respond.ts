/** JSON response helpers. The engine speaks nothing else. */
import type { ServerResponse } from 'node:http'

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function fail(res: ServerResponse, status: number, error: string): void {
  json(res, status, { error })
}

/** Turn a thrown value into a 400 with a readable message. */
export function failFrom(res: ServerResponse, err: unknown): void {
  fail(res, 400, err instanceof Error ? err.message : String(err))
}

/** Collect a request body, then hand it to a handler. */
export function withBody(req: NodeJS.ReadableStream, handler: (body: string) => Promise<void>): void {
  let body = ''
  req.on('data', (c: Buffer) => {
    body += c
  })
  req.on('end', () => void handler(body))
}

export const round2 = (n: number): number => Math.round(n * 100) / 100
