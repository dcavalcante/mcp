import { All, Controller, Inject, Req, Res, type ControllerOptions, type Type } from '@nestjs/common';
import { McpHttpService } from './mcp-http.service.js';

/**
 * The controller of the Streamable HTTP endpoint, at `path`: a route like any other, so the global prefix,
 * versioning, middleware, CORS and HTTP guards apply to it. `decorators` (class decorators) are applied to it.
 */
export function createMcpController(
  path: string,
  version: ControllerOptions['version'],
  decorators: ClassDecorator[],
): Type<unknown> {
  @Controller({ path, ...(version !== undefined && { version }) })
  class McpController {
    constructor(@Inject(McpHttpService) private readonly http: McpHttpService) {}

    /** POST carries every MCP message; GET and DELETE (2025 sessions) are answered 405 by the SDK. */
    @All()
    async handle(@Req() request: unknown, @Res() response: unknown): Promise<void> {
      await this.http.serve(request, response);
    }
  }

  for (const decorator of decorators) {
    decorator(McpController);
  }
  return McpController;
}
