/**
 * Stdio MCP server that `claude -p` spawns. It is deliberately dumb: every tools/list and tools/call is
 * forwarded over HTTP to the harness bridge (TOOLSCALE_BRIDGE=http://127.0.0.1:PORT/s/<session>), which
 * owns all state. When a call adds tools, the bridge says so and we notify Claude Code to re-list.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const base = process.env.TOOLSCALE_BRIDGE;
if (!base) throw new Error('TOOLSCALE_BRIDGE not set');

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`bridge ${path} → ${r.status}`);
  return (await r.json()) as T;
}

const server = new Server(
  { name: 'ts', version: '0.1.0' },
  { capabilities: { tools: { listChanged: true } } },
);

server.setRequestHandler(ListToolsRequestSchema, async () =>
  post<{ tools: never[] }>('/tools', {}),
);

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const r = await post<{ output: unknown; listChanged?: boolean }>('/call', {
    name: req.params.name,
    args: req.params.arguments ?? {},
  });
  if (r.listChanged) await server.sendToolListChanged();
  const isError = typeof r.output === 'object' && r.output !== null && 'error' in r.output;
  return { content: [{ type: 'text', text: JSON.stringify(r.output) }], isError };
});

await server.connect(new StdioServerTransport());
