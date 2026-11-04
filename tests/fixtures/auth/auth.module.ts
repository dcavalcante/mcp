import {
  Injectable,
  Module,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthInfo } from '@modelcontextprotocol/server';
import {
  McpExecutionContext,
  McpModule,
  Prompt,
  ResourceTemplate,
  Tool,
  type McpContext,
  type McpModuleRootOptions,
  type McpTokenVerifier,
} from '../../../lib/index.js';

export const RESOURCE = 'https://notes.example.com/mcp';
export const ISSUER = 'https://auth.example.com';

/** The tokens the identity provider issued, as introspection would return them. */
@Injectable()
export class TokenStore {
  private readonly tokens = new Map<string, Omit<AuthInfo, 'token'> | 'revoked' | 'malformed' | 'outage'>();

  constructor() {
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    const resource = new URL(RESOURCE);
    this.tokens.set('reader', { clientId: 'alice', scopes: ['notes:read'], expiresAt: inAnHour, resource });
    this.tokens.set('writer', { clientId: 'bob', scopes: ['notes:read', 'notes:write'], expiresAt: inAnHour, resource });
    this.tokens.set('guest', { clientId: 'carol', scopes: [], expiresAt: inAnHour, resource });
    this.tokens.set('expired', { clientId: 'alice', scopes: ['notes:read'], expiresAt: 1_000, resource });
    this.tokens.set('elsewhere', {
      clientId: 'alice',
      scopes: ['notes:read', 'notes:write'],
      expiresAt: inAnHour,
      resource: new URL('https://other.example.com/mcp'),
    });
    this.tokens.set('revoked', 'revoked');
    this.tokens.set('malformed', 'malformed');
    this.tokens.set('outage', 'outage');
  }

  lookup(token: string) {
    return this.tokens.get(token);
  }
}

@Module({ providers: [TokenStore], exports: [TokenStore] })
export class TokenModule {}

/** A verifier class: Nest instantiates it, with its dependencies from `imports`. */
@Injectable()
export class StoreTokenVerifier implements McpTokenVerifier {
  constructor(private readonly store: TokenStore) {}

  async verifyAccessToken(token: string): Promise<AuthInfo | null> {
    const found = this.store.lookup(token);
    if (found === 'revoked') {
      throw new UnauthorizedException('Token revoked');
    }
    if (found === 'malformed') {
      // What @nestjs/authentication's JwtVerifier throws: an error with `status: 401`.
      throw Object.assign(new Error('signature mismatch'), { status: 401 });
    }
    if (found === 'outage') {
      throw new Error('identity provider unreachable');
    }
    return found ? { token, ...found } : null;
  }
}

/** Only Bob may export. */
@Injectable()
export class BobOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return McpExecutionContext.create(context).getAuthInfo()?.clientId === 'bob';
  }
}

@Injectable()
export class SecuredTools {
  @Tool({ description: 'Who is calling' })
  whoami(_input: unknown, ctx: McpContext) {
    const { clientId, scopes } = ctx.authInfo!;
    return { clientId, scopes };
  }

  @Tool({ description: 'List the notes', scopes: ['notes:read'] })
  list() {
    return 'note-1, note-2';
  }

  @Tool({ description: 'Delete a note', scopes: ['notes:write'] })
  remove() {
    return 'deleted';
  }

  @Tool({ description: 'Export the notes' })
  @UseGuards(BobOnlyGuard)
  export() {
    return 'exported';
  }

  @ResourceTemplate({ uriTemplate: 'private://{id}', scopes: ['notes:write'] })
  privateNote({ id }: { id: string }) {
    return `private ${id}`;
  }

  @Prompt({ description: 'Write a note', scopes: ['notes:write'] })
  draft() {
    return 'Draft a note.';
  }
}

export const authOptions = {
  name: 'secured-notes',
  version: '1.0.0',
  imports: [TokenModule],
  auth: {
    verifier: StoreTokenVerifier,
    resource: RESOURCE,
    authorizationServers: [ISSUER],
    scopesSupported: ['notes:read'],
    resourceName: 'Notes',
  },
} satisfies McpModuleRootOptions;

@Module({ imports: [McpModule.forRoot(authOptions)], providers: [SecuredTools] })
export class AuthAppModule {}

/** Every request needs `notes:read`. */
@Module({
  imports: [McpModule.forRoot({ ...authOptions, auth: { ...authOptions.auth, requiredScopes: ['notes:read'] } })],
  providers: [SecuredTools],
})
export class ReadersOnlyAppModule {}
