import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './server.js'

const PORT = Number(process.env.MCP_PORT ?? 7071)

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { void transport.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res)
}

const http = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
    })
    res.end()
    return
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }
  void handleMcp(req, res).catch((err) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  })
})

http.listen(PORT, () => {
  console.log(`aw-mcp on :${PORT} — streamable HTTP transport (stateless)`)
})

process.on('SIGTERM', () => { http.close(() => process.exit(0)) })
process.on('SIGINT', () => { http.close(() => process.exit(0)) })
