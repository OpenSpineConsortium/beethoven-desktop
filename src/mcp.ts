// The Model Context Protocol over stdio, by hand: JSON-RPC 2.0, one message per line. A server this
// small needs initialize, ping, tools/list and tools/call, and writing them here keeps the bundle free
// of any dependency (the official SDK would bring an HTTP server and an HTTP client with it, and this
// edition's rule is that no network code of its own exists; scripts/forbidden.mjs checks the build).
// The tests talk to this server with the official SDK's client, so the two are held to each other.

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  call: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  instructions: string;
}

type Id = string | number;
interface Msg {
  jsonrpc?: string;
  id?: Id | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ERR = { PARSE: -32700, INVALID: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 } as const;
/** one message at most this large: nothing this server is asked for comes near it */
const MAX_LINE = 4 * 1024 * 1024;

export class McpServer {
  private buf = '';
  private readonly tools = new Map<string, Tool>();

  constructor(private readonly info: ServerInfo, tools: Tool[], private readonly write: (line: string) => void) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** feed bytes from stdin; each complete line is one message, answered in its own time */
  feed(chunk: string): void {
    this.buf += chunk;
    if (this.buf.length > MAX_LINE && !this.buf.includes('\n')) {
      this.buf = '';
      this.send({ jsonrpc: '2.0', id: null, error: { code: ERR.INVALID, message: 'message too large' } });
      return;
    }
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line.trim()) void this.handleLine(line);
    }
  }

  private send(obj: unknown): void {
    this.write(JSON.stringify(obj) + '\n');
  }

  async handleLine(line: string): Promise<void> {
    let msg: Msg;
    try {
      msg = JSON.parse(line) as Msg;
    } catch {
      this.send({ jsonrpc: '2.0', id: null, error: { code: ERR.PARSE, message: 'parse error' } });
      return;
    }
    if (Array.isArray(msg) || typeof msg !== 'object' || msg === null || msg.jsonrpc !== '2.0') {
      this.send({ jsonrpc: '2.0', id: null, error: { code: ERR.INVALID, message: 'invalid request' } });
      return;
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (typeof msg.method !== 'string') {
      // a response to a request of ours: this server sends none, so there is nothing to match
      return;
    }
    if (!isRequest) return; // notifications: initialized, cancelled, progress; nothing to answer
    const id = msg.id as Id;
    try {
      const result = await this.dispatch(msg.method, msg.params ?? {});
      this.send({ jsonrpc: '2.0', id, result });
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError(ERR.INTERNAL, 'internal error');
      this.send({ jsonrpc: '2.0', id, error: { code: err.code, message: err.message } });
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0];
        return {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.info.name, title: this.info.title, version: this.info.version },
          instructions: this.info.instructions,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: [...this.tools.values()].map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { title: t.title, ...t.annotations },
          })),
        };
      case 'tools/call': {
        const name = params.name;
        const tool = typeof name === 'string' ? this.tools.get(name) : undefined;
        if (!tool) throw new RpcError(ERR.PARAMS, `no tool named ${String(name)}`);
        const args = params.arguments ?? {};
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new RpcError(ERR.PARAMS, 'arguments must be an object');
        try {
          return await tool.call(args as Record<string, unknown>);
        } catch (e) {
          // a tool's own failure is a result the model can read, not a protocol error
          const text = e instanceof ArgError ? e.message : 'Beethoven hit an error it did not expect. Nothing was changed on the grid by this request.';
          return { content: [{ type: 'text', text }], isError: true } satisfies ToolResult;
        }
      }
      default:
        throw new RpcError(ERR.METHOD, `method not found: ${method}`);
    }
  }
}

export class RpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
  }
}

/** a tool argument that fails its test; its message goes to the model as the result */
export class ArgError extends Error {}

/** start serving on this process's stdin and stdout; nothing else is ever written to stdout */
export function serveStdio(server: (write: (line: string) => void) => McpServer): void {
  const s = server((line) => process.stdout.write(line));
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c: string) => s.feed(c));
  process.stdin.on('end', () => process.exit(0));
}
