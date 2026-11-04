import type { PromptOptions } from '../interfaces/primitive-options.interface.js';
import { definePrimitive } from './define-primitive.util.js';

/**
 * Exposes the method as an MCP prompt. It is called as `(args, context)`, with `args` validated against `argsSchema`,
 * and may return a `GetPromptResult`, an array of prompt messages, or a string (one user message).
 *
 * ```ts
 * @Prompt({ description: 'Review code', argsSchema: z.object({ code: z.string() }) })
 * review({ code }: { code: string }) {
 *   return `Review this code:\n\n${code}`;
 * }
 * ```
 */
export function Prompt(options: PromptOptions = {}): MethodDecorator {
  return definePrimitive({ kind: 'prompt', options: { ...options } });
}
