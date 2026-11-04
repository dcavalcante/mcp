import { HttpException, type LoggerService } from '@nestjs/common';
import {
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
  type AuthInfo,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/server';
import type { McpAuthOptions } from '../interfaces/mcp-module-options.interface.js';
import type { McpTokenVerifier } from '../interfaces/mcp-token-verifier.interface.js';
import { httpExceptionMessage } from '../utils/errors.util.js';
import { assertScopes } from '../utils/names.util.js';

/**
 * The OAuth resource server half of the MCP spec, for the HTTP endpoint: verifies each request's bearer token (its
 * audience must be `resource`), answers refusals with the spec's 401/403 and `WWW-Authenticate` challenge, and holds
 * the RFC 9728 protected resource metadata the challenge points at.
 */
export class McpAuthGate {
  /** The URL of the protected resource metadata document, as challenges advertise it. */
  readonly metadataUrl: string;
  /** The paths the metadata document is served at: the path-aware location of `resource`, and the root one. */
  readonly metadataPaths: string[];
  readonly metadata: OAuthProtectedResourceMetadata;

  private readonly resource: URL;
  private readonly requiredScopes: string[];
  private readonly verifier: McpTokenVerifier;

  constructor(options: McpAuthOptions, verifier: McpTokenVerifier | undefined, private readonly logger: LoggerService) {
    if (!verifier || typeof verifier.verifyAccessToken !== 'function') {
      throw new TypeError(
        'McpModule: `auth.verifier` must be a token verifier: a class with verifyAccessToken(token) in forRoot(), or an ' +
          'instance of one (from the forRootAsync() factory).',
      );
    }
    if (typeof options.resource !== 'string' || !URL.canParse(options.resource)) {
      throw new TypeError(
        `McpModule: \`auth.resource\` must be the absolute URL of this MCP server, such as "https://api.example.com/mcp". Got ${String(options.resource)}.`,
      );
    }
    const resource = new URL(options.resource);
    if (resource.hash) {
      throw new TypeError(`McpModule: \`auth.resource\` must not have a fragment: ${options.resource}.`);
    }
    if (
      !Array.isArray(options.authorizationServers) ||
      options.authorizationServers.length === 0 ||
      !options.authorizationServers.every((issuer) => typeof issuer === 'string' && URL.canParse(issuer))
    ) {
      throw new TypeError(
        'McpModule: `auth.authorizationServers` must list the issuer URL of at least one authorization server.',
      );
    }
    assertScopes(options.requiredScopes?.length ? options.requiredScopes : undefined, 'McpModule `auth.requiredScopes`');
    assertScopes(options.scopesSupported?.length ? options.scopesSupported : undefined, 'McpModule `auth.scopesSupported`');

    this.verifier = verifier;
    this.resource = resource;
    this.requiredScopes = options.requiredScopes ?? [];
    this.metadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
    this.metadataPaths = [...new Set([new URL(this.metadataUrl).pathname, '/.well-known/oauth-protected-resource'])];
    this.metadata = {
      // As configured: the spec asks for the form without a trailing slash, which `URL.href` adds to a bare origin.
      resource: options.resource,
      authorization_servers: options.authorizationServers,
      bearer_methods_supported: ['header'],
      ...(options.scopesSupported && { scopes_supported: options.scopesSupported }),
      ...(options.resourceName && { resource_name: options.resourceName }),
      ...(options.resourceDocumentation && { resource_documentation: options.resourceDocumentation }),
    };
  }

  /** The verified token of `request`, or the response refusing it. */
  async authenticate(request: Request): Promise<AuthInfo | Response> {
    try {
      return await verifyBearerToken(request.headers.get('authorization'), {
        verifier: { verifyAccessToken: (token) => this.verify(token) },
        requiredScopes: this.requiredScopes,
        resourceMetadataUrl: this.metadataUrl,
        expectedResource: this.resource,
      });
    } catch (error) {
      if (!(error instanceof OAuthError)) {
        this.logger.error(
          `The MCP token verifier failed: ${(error as Error)?.message ?? String(error)}`,
          (error as Error)?.stack,
          'McpModule',
        );
      }
      return bearerAuthChallengeResponse(error, {
        requiredScopes: this.requiredScopes,
        resourceMetadataUrl: this.metadataUrl,
      });
    }
  }

  private async verify(token: string): Promise<AuthInfo> {
    let authInfo: AuthInfo | null | undefined;
    try {
      authInfo = await this.verifier.verifyAccessToken(token);
    } catch (error) {
      // An UnauthorizedException, or any error with `status: 401` (@nestjs/authentication's JwtError): the token is
      // refused. Anything else is an outage.
      if (error instanceof HttpException ? error.getStatus() === 401 : (error as { status?: unknown })?.status === 401) {
        const message = error instanceof HttpException ? httpExceptionMessage(error) : (error as Error).message;
        throw new OAuthError(OAuthErrorCode.InvalidToken, message || 'Invalid token');
      }
      throw error;
    }
    if (!authInfo) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid token');
    }
    return authInfo;
  }
}
