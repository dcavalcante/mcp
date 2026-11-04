import type { AuthInfo } from '@modelcontextprotocol/server';

/**
 * Verifies the bearer tokens of MCP requests, as an OAuth resource server does. The same shape as the SDK's
 * `OAuthTokenVerifier`, so an SDK verifier works as it is.
 *
 * Return the token's `AuthInfo` to accept it: `clientId`, `scopes`, `expiresAt` (seconds since the epoch, required:
 * a token without it is refused) and `resource` (the token's audience, compared with the `resource` option) come from
 * the token's claims or the introspection response. Return `null`, or throw an error with `status: 401` (an
 * `UnauthorizedException`, `@nestjs/authentication`'s `JwtError`) or the SDK's `OAuthError` with
 * `OAuthErrorCode.InvalidToken`, to refuse it: the client gets 401 and a `WWW-Authenticate` challenge. Anything else
 * thrown (the identity provider is down) is answered with 500.
 */
export interface McpTokenVerifier {
  verifyAccessToken(token: string): AuthInfo | null | undefined | Promise<AuthInfo | null | undefined>;
}
