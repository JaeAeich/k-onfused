import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const MCP_SERVER_NAME = 'ts';
/** Claude Code exposes MCP tools to the model as mcp__<server>__<tool>. */
export const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** A tool as the model sees it: raw JSON Schema input. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Anything that can answer tools/list and tools/call for one agent session. */
export interface BridgeHandler {
  listTools(): ToolSpec[];
  call(name: string, args: unknown): Promise<{ output: unknown; listChanged?: boolean }>;
}

/**
 * Local HTTP endpoint the stdio MCP shim talks to. One bridge per harness process; one handler per
 * live agent session (worker or query agent). Keeps the embedder, Qdrant client and traces in-process.
 *
 *   POST /s/<session>/tools  → { tools }
 *   POST /s/<session>/call   { name, args } → { output, listChanged }
 */
export class Bridge {
  private sessions = new Map<string, BridgeHandler>();
  private server = http.createServer((req, res) => void this.handle(req, res));
  private port = 0;

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  close(): void {
    this.server.close();
  }

  register(id: string, handler: BridgeHandler): void {
    this.sessions.set(id, handler);
  }

  unregister(id: string): void {
    this.sessions.delete(id);
  }

  url(id: string): string {
    return `http://127.0.0.1:${this.port}/s/${id}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const match = /^\/s\/([^/]+)\/(tools|call)$/.exec(req.url ?? '');
    const handler = match && this.sessions.get(match[1]!);
    if (!handler || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      let out: unknown;
      if (match[2] === 'tools') {
        out = { tools: handler.listTools() };
      } else {
        const { name, args } = JSON.parse(body) as { name: string; args?: unknown };
        out = await handler.call(String(name), args ?? {});
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch (e) {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: String(e) }));
    }
  }
}
