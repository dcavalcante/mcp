import type { ResourceTemplateOptions } from '../interfaces/primitive-options.interface.js';
import { definePrimitive } from './define-primitive.util.js';

/**
 * Exposes the method as the MCP resources matching an RFC 6570 `uriTemplate`. It is called as `(variables, context)`:
 * the template's variables (strings) and the `McpContext`, with the URI being read as `context.uri`. Its return value
 * is read as `@Resource()`'s is; a `NotFoundException` answers with the spec's resource-not-found error.
 *
 * ```ts
 * @ResourceTemplate({ uriTemplate: 'notes://{id}', mimeType: 'text/plain' })
 * note({ id }: { id: string }) {
 *   return this.notes.get(id);
 * }
 * ```
 */
export function ResourceTemplate(options: ResourceTemplateOptions): MethodDecorator {
  if (typeof options?.uriTemplate !== 'string' || options.uriTemplate.length === 0) {
    throw new TypeError(
      `@ResourceTemplate() needs { uriTemplate }: an RFC 6570 URI template, such as "notes://{id}". Got ${String(options?.uriTemplate)}.`,
    );
  }
  return definePrimitive({ kind: 'resource-template', options: { ...options } });
}
