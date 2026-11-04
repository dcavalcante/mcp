import type { AuthInfo, ServerContext } from '@modelcontextprotocol/server';

/** What a call is for. A read through a resource template is a `resource` call. */
export type McpCallKind = 'tool' | 'resource' | 'prompt';

/**
 * The protocol era of the request: `modern` for revision 2026-07-28 (no `initialize`, a `_meta` envelope on every
 * request), `legacy` for 2024-10-07 through 2025-11-25.
 */
export type McpProtocolEra = 'legacy' | 'modern';

/** What every call's context has, whoever made the call. */
interface McpCallContext<TRequest> {
  readonly kind: McpCallKind;
  /** The tool or prompt name, or the resource's name. */
  readonly name: string;
  /** The URI being read, for resources. */
  readonly uri?: URL;
  /**
   * The verified access token, when the module's `auth` option is configured (HTTP only). `clientId`, `scopes`,
   * `expiresAt` and `extra` are what the token verifier returned.
   */
  readonly authInfo?: AuthInfo;
  /**
   * The HTTP platform's request object (Express, Fastify or the Node adapter's), as route handlers get it: headers,
   * `request.user` set by middleware, and so on. For the in-memory test client, a plain `{ method, url, headers }`
   * object; `undefined` over stdio. For an agent's call, the request the agent runs in, if it runs in one.
   */
  readonly request?: TRequest;
  /** Aborted when the client cancels the request or goes away. Pass it on to your own I/O. */
  readonly signal: AbortSignal;
  /**
   * Sends a progress notification for this request, if the client asked for progress (its request carries a
   * `progressToken`); does nothing otherwise. `progress` must grow from one call to the next.
   */
  reportProgress(progress: number, total?: number, message?: string): Promise<void>;
}

/** A call from an MCP client, over Streamable HTTP (and the in-memory test client) or stdio. */
export interface McpClientContext<TRequest = any> extends McpCallContext<TRequest> {
  /** `http` for Streamable HTTP (and the in-memory test client), `stdio` for stdio. */
  readonly transport: 'http' | 'stdio';
  readonly era: McpProtocolEra;
  /** The web-standard `Request` the SDK served, over HTTP (and in-memory). */
  readonly requestInfo?: Request;
  /** The 2025-era session id; always `undefined` in this version, which serves every request statelessly. */
  readonly sessionId?: string;
  /**
   * The SDK's own request context, for what has no shortcut here: `mcpReq.envelope` (the client's declared
   * capabilities and info, 2026-07-28), `mcpReq.inputResponses` (answers to an `inputRequired()` result),
   * `mcpReq.notify()`, `mcpReq._meta`.
   */
  readonly server: ServerContext;
}

/**
 * A call from the application's own agent, not from an MCP client. No protocol request is behind it, so it has no
 * era, session or SDK context: a tool that asks the user with `inputRequired()` can do so only for MCP clients.
 */
export interface McpAgentContext<TRequest = any, TUser = any> extends McpCallContext<TRequest> {
  readonly transport: 'agent';
  /** The user the agent acts for, when it runs outside an HTTP request (a queue job, a workflow). */
  readonly user?: TUser;
  /** The scopes the agent's caller holds. A tool's `scopes` require them. */
  readonly scopes?: readonly string[];
}

/**
 * The second argument of every MCP method, and `McpExecutionContext.getContext()` in guards, interceptors and
 * filters. Check `transport` before reading what only one kind of call has: `server`, `era`, `requestInfo` and
 * `sessionId` come with calls from MCP clients, `user` and `scopes` with an agent's.
 */
export type McpContext<TRequest = any> = McpClientContext<TRequest> | McpAgentContext<TRequest>;
