import type { McpSchema } from '../interfaces/primitive-options.interface.js';

/** The JSON Schema draft the SDK converts to. */
const TARGET = 'draft-2020-12';

type Converter = (options: { target: string; libraryOptions?: Record<string, unknown> }) => Record<string, unknown>;

/**
 * Checks that `schema` is a schema the SDK can advertise (a Standard Schema with `~standard.jsonSchema`) and returns
 * it with its JSON Schema conversions computed once. The SDK builds a server per request and converts every schema
 * on each `tools/list` (and every 2026-07-28 `tools/call`); the conversion result never changes. Everything else
 * about the schema (its validation, its library's own properties) is the original's.
 *
 * `io: 'input'` schemas (tool and prompt arguments) must describe objects.
 */
export function prepareSchema(schema: McpSchema, where: string, io: 'input' | 'output'): McpSchema {
  const standard = (schema as Partial<McpSchema> | undefined)?.['~standard'];
  if (!standard || typeof standard.validate !== 'function') {
    throw new TypeError(
      `${where}: not a Standard Schema. Pass a Zod 4.2+ schema (z.object({ ... })), an ArkType type, a Valibot schema ` +
        'wrapped with toStandardJsonSchema(), or a JSON Schema wrapped with fromJsonSchema() from @modelcontextprotocol/server.',
    );
  }
  const jsonSchema = standard.jsonSchema as { input?: Converter; output?: Converter } | undefined;
  if (typeof jsonSchema?.input !== 'function' || typeof jsonSchema?.output !== 'function') {
    throw new TypeError(
      `${where}: the "${standard.vendor}" schema cannot produce JSON Schema (no ~standard.jsonSchema), which MCP ` +
        'clients need. Zod needs 4.2 or later (Zod 3 is not supported); Valibot needs toStandardJsonSchema() from ' +
        '@valibot/to-json-schema; a JSON Schema document goes through fromJsonSchema().',
    );
  }

  const converted = new Map<string, Record<string, unknown>>();
  const memoize =
    (kind: 'input' | 'output', convert: Converter): Converter =>
    (options) => {
      const key = `${kind}:${options?.target}`;
      let result = converted.get(key);
      if (!result) {
        result = convert(options);
        converted.set(key, result);
      }
      // A copy, so that nothing the SDK does with one request's schema reaches the next.
      return structuredClone(result);
    };

  let root: Record<string, unknown>;
  try {
    root = jsonSchema[io]!({ target: TARGET });
  } catch (error) {
    throw new TypeError(`${where}: the schema cannot be converted to JSON Schema: ${(error as Error)?.message ?? error}`);
  }
  if (io === 'input' && root.type !== undefined && root.type !== 'object') {
    throw new TypeError(
      `${where}: arguments are an object, and this schema describes ${JSON.stringify(root.type)}. Wrap it in z.object({ ... }).`,
    );
  }
  converted.set(`${io}:${TARGET}`, root);

  const cached = {
    ...standard,
    validate: (value: unknown, options?: Parameters<typeof standard.validate>[1]) => standard.validate(value, options),
    jsonSchema: {
      input: memoize('input', (options) => jsonSchema.input!(options)),
      output: memoize('output', (options) => jsonSchema.output!(options)),
    },
  };
  return new Proxy(schema, {
    get: (target, property) => (property === '~standard' ? cached : Reflect.get(target, property, target)),
  });
}
