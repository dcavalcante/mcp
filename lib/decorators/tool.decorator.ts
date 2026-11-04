import type { ToolOptions } from '../interfaces/primitive-options.interface.js';
import { definePrimitive } from './define-primitive.util.js';

/**
 * Exposes the method as an MCP tool. It is called as `(input, context)`: `input` is the arguments, validated against
 * `inputSchema`, and `context` the `McpContext`. Guards, interceptors, pipes and exception filters run around it.
 *
 * It may return a `CallToolResult`, the SDK's `inputRequired()` result, a string (a text result), or any other value:
 * with an `outputSchema` it becomes the `structuredContent` (and a JSON text block), without one a JSON text block.
 * A returned value that matches the output schema is treated as application data even if its shape also resembles a
 * tool result. To return an intentionally formatted result alongside an output schema, include `structuredContent`;
 * an `isError: true` result is also preserved as authored.
 *
 * ```ts
 * @Tool({ description: 'Save a note', inputSchema: z.object({ text: z.string() }) })
 * add({ text }: { text: string }, ctx: McpContext) {
 *   return this.notes.add(text);
 * }
 * ```
 */
export function Tool(options: ToolOptions = {}): MethodDecorator {
  return definePrimitive({ kind: 'tool', options: { ...options } });
}
