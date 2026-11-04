import type {
  Annotations,
  CacheHint,
  Icon,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from '@modelcontextprotocol/server';

/**
 * Any schema the MCP SDK accepts: a Standard Schema that also produces JSON Schema (`~standard.jsonSchema`). Zod
 * 4.2+ and ArkType schemas are, as they are; Valibot through `toStandardJsonSchema()` from
 * `@valibot/to-json-schema`; a plain JSON Schema document through `fromJsonSchema()` from
 * `@modelcontextprotocol/server`.
 */
export type McpSchema<Input = any, Output = Input> = StandardSchemaWithJSON<Input, Output>;

interface PrimitiveOptions {
  /**
   * Display name for people (the `name` is for programs). Optional.
   */
  title?: string;
  /** What it does. The model reads it to decide when to use it: worth writing well. */
  description?: string;
  icons?: Icon[];
  /** The primitive's `_meta`, advertised as given. */
  _meta?: Record<string, unknown>;
  /**
   * OAuth scopes the caller's token must carry, all of them. A call without them is answered with HTTP 403
   * `insufficient_scope` and these scopes in the `WWW-Authenticate` challenge, so the client can ask for them (step-up
   * authorization), before the method runs. Needs the module's `auth` option on HTTP; over stdio, where the spec
   * takes credentials from the environment, they are not checked.
   */
  scopes?: string[];
}

export interface ToolOptions extends PrimitiveOptions {
  /**
   * Unique among the server's tools: 1 to 128 characters out of `A-Z a-z 0-9 _ - .`, not starting or ending with
   * `-` or `.`. Defaults to the method name.
   */
  name?: string;
  /**
   * The arguments. The SDK validates every call against it before the method runs (a failure is a tool result
   * with `isError: true`) and advertises its JSON Schema in `tools/list`. Its root must be an object. Without one,
   * the tool takes no arguments.
   */
  inputSchema?: McpSchema;
  /**
   * The structured result. The method's return value (or the `structuredContent` of a `CallToolResult` it returns)
   * is validated against it before it leaves the server.
   */
  outputSchema?: McpSchema;
  /** Behavior hints for clients: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. */
  annotations?: ToolAnnotations;
}

export interface ResourceOptions extends PrimitiveOptions {
  /** The resource's URI, e.g. `config://app`. Unique among the server's resources. */
  uri: string;
  /** Defaults to the method name. */
  name?: string;
  /** The MIME type of what the method returns, used when it returns a string or bytes. */
  mimeType?: string;
  /** Size in bytes, when known. */
  size?: number;
  annotations?: Annotations;
  /** Caching hint for `resources/read` results (protocol revision 2026-07-28). */
  cacheHint?: CacheHint;
}

export interface ResourceTemplateOptions extends PrimitiveOptions {
  /** An RFC 6570 URI template, e.g. `notes://{id}`. The method receives its variables. */
  uriTemplate: string;
  /** Defaults to the method name. */
  name?: string;
  /** The MIME type of what the method returns, used when it returns a string or bytes. */
  mimeType?: string;
  annotations?: Annotations;
  /** Caching hint for `resources/read` results (protocol revision 2026-07-28). */
  cacheHint?: CacheHint;
}

export interface PromptOptions extends PrimitiveOptions {
  /** Unique among the server's prompts. Defaults to the method name. */
  name?: string;
  /**
   * The arguments, an object schema. The SDK validates them and advertises each property (with its description) as a
   * prompt argument.
   */
  argsSchema?: McpSchema;
}

/** What the primitive decorators record on a method (internal). */
export type McpPrimitiveMetadata =
  | { kind: 'tool'; options: ToolOptions }
  | { kind: 'resource'; options: ResourceOptions }
  | { kind: 'resource-template'; options: ResourceTemplateOptions }
  | { kind: 'prompt'; options: PromptOptions };
