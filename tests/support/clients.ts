import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export const eras = ['modern', 'legacy'] as const;
export type Era = (typeof eras)[number];

/** An SDK client connected over Streamable HTTP: `modern` pins revision 2026-07-28, `legacy` does the 2025 handshake. */
export async function connect(url: URL, era: Era, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client(
    { name: 'e2e', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  return client;
}

/** The text of a tool result's first block. */
export function text(result: { content?: unknown }): string | undefined {
  const [first] = (result.content ?? []) as { type: string; text?: string }[];
  return first?.type === 'text' ? first.text : undefined;
}
