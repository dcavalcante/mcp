import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { McpExecutionContext } from '@nestjs/mcp';

/**
 * Refuses tools that change something when the server runs read-only (`NOTES_READ_ONLY=true`). Reads the tool's
 * annotations through the execution context, as any guard reads its route's metadata.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const mcp = McpExecutionContext.create(context);
    const readOnly = process.env.NOTES_READ_ONLY === 'true';
    return !readOnly || mcp.getKind() !== 'tool' || mcp.getName() === 'search';
  }
}
