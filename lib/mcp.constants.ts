/** Where `@Tool()`, `@Resource()`, `@ResourceTemplate()` and `@Prompt()` record themselves, on the method. */
export const MCP_PRIMITIVE_METADATA = 'nestjs:mcp:primitive';

/**
 * The parameter metadata of MCP handlers, read by `ExternalContextCreator` (so that pipes run on the input): Nest's
 * own route-arguments key, where `createParamDecorator()` decorators (`@CurrentUser()`) record themselves, as for
 * GraphQL resolvers. The module adds the input and the context to it at startup.
 */
export const MCP_PARAMS_METADATA = '__routeArguments__';

/** The `ExecutionContext` type of MCP calls: `context.getType() === 'mcp'`. */
export const MCP_CONTEXT_TYPE = 'mcp';

/** The HTTP endpoint the module serves (`{ path }`, `path` being `null` when it serves none). Internal. */
export const MCP_HTTP_ENDPOINT = Symbol('MCP_HTTP_ENDPOINT');

/** The token verifier `forRoot()` was given as a class, instantiated by Nest. Internal. */
export const MCP_TOKEN_VERIFIER = Symbol('MCP_TOKEN_VERIFIER');

/** Default HTTP path of the endpoint. */
export const DEFAULT_MCP_PATH = 'mcp';

/** The module options (`forRoot()`'s, or what the `forRootAsync()` factory returns). */
export const MCP_MODULE_OPTIONS = 'MCP_MODULE_OPTIONS';
