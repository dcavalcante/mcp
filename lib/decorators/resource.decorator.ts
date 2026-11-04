import type { ResourceOptions } from '../interfaces/primitive-options.interface.js';
import { definePrimitive } from './define-primitive.util.js';

/**
 * Exposes the method as the MCP resource at a fixed `uri`. It is called as `({}, context)`, with the URI as
 * `context.uri`, and may return a `ReadResourceResult`, a string (text, of `mimeType`), bytes (a `Uint8Array` or
 * `Buffer`, sent as a blob) or another value (sent as JSON).
 *
 * ```ts
 * @Resource({ uri: 'config://app', mimeType: 'application/json' })
 * config() {
 *   return this.config.public();
 * }
 * ```
 */
export function Resource(options: ResourceOptions): MethodDecorator {
  if (typeof options?.uri !== 'string' || !URL.canParse(options.uri)) {
    throw new TypeError(`@Resource() needs { uri }: an absolute URI, such as "config://app". Got ${String(options?.uri)}.`);
  }
  return definePrimitive({ kind: 'resource', options: { ...options } });
}
