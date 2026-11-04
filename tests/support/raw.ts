/** Hand-written MCP requests, for what an SDK client hides: status codes and headers. */

export const MODERN = '2026-07-28';

/** A 2025-era JSON-RPC request (no session needed: the endpoint is stateless). */
export function legacyRequest(url: URL, method: string, params: object = {}, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

/** A 2026-07-28 request: the `_meta` envelope and the standard headers. */
export function modernRequest(
  url: URL,
  method: string,
  params: Record<string, unknown> & { name?: string; uri?: string } = {},
  headers: Record<string, string> = {},
) {
  const name = params.name ?? params.uri;
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN,
      'mcp-method': method,
      ...(name !== undefined && { 'mcp-name': name }),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

/** The JSON-RPC message of a response, whether it came as JSON or as one SSE event. */
export async function messageOf(response: Response): Promise<any> {
  const body = await response.text();
  if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const data = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .at(-1);
    return data ? JSON.parse(data) : undefined;
  }
  return body ? JSON.parse(body) : undefined;
}

/** The parameters of a `WWW-Authenticate: Bearer ...` challenge. */
export function challengeOf(response: Response): Record<string, string> | undefined {
  const header = response.headers.get('www-authenticate');
  if (!header?.startsWith('Bearer')) {
    return undefined;
  }
  return Object.fromEntries([...header.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)].map(([, key, value]) => [key, value]));
}

/**
 * A 2025-era `tools/list` POST naming its own `Host`, which fetch() does not let a caller set: what a DNS-rebinding
 * page's request looks like to a server on the loopback interface. Resolves with the status code.
 */
export async function statusWithHost(url: URL, host: string): Promise<number | undefined> {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'POST', headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
}
