import { Injectable, NotFoundException, UseGuards, UseInterceptors } from '@nestjs/common';
import { Prompt, Resource, ResourceTemplate, Tool, type McpContext } from '@nestjs/mcp';
import * as z from 'zod';
import { NotesService } from './notes.service.js';
import { ReadOnlyGuard } from './read-only.guard.js';
import { TimingInterceptor } from './timing.interceptor.js';

const NoteSchema = z.object({ id: z.string(), text: z.string(), author: z.string() });

@Injectable()
@UseGuards(ReadOnlyGuard)
@UseInterceptors(TimingInterceptor)
export class NotesTools {
  constructor(private readonly notes: NotesService) {}

  @Tool({
    description: 'Save a note and return it',
    inputSchema: z.object({ text: z.string().min(1).max(2000).describe('The text of the note') }),
    outputSchema: NoteSchema,
  })
  add({ text }: { text: string }, ctx: McpContext) {
    return this.notes.add(text, ctx.authInfo?.clientId ?? 'anonymous');
  }

  @Tool({
    description: 'Find the notes containing a text',
    inputSchema: z.object({ query: z.string().describe('Text to look for, case-insensitive') }),
    outputSchema: z.object({ notes: z.array(NoteSchema) }),
    annotations: { readOnlyHint: true },
  })
  search({ query }: { query: string }) {
    return { notes: this.notes.search(query) };
  }

  @Resource({ uri: 'notes://all', description: 'Every note', mimeType: 'application/json' })
  all() {
    return this.notes.all();
  }

  @ResourceTemplate({ uriTemplate: 'notes://{id}', description: 'One note, by id', mimeType: 'text/plain' })
  note({ id }: { id: string }) {
    const note = this.notes.find(id);
    if (!note) {
      throw new NotFoundException(`There is no note ${id}`);
    }
    return note.text;
  }

  @Prompt({
    description: 'Summarize the notes',
    argsSchema: z.object({ style: z.enum(['bullets', 'paragraph']).describe('The shape of the summary') }),
  })
  summarize({ style }: { style: 'bullets' | 'paragraph' }) {
    const notes = this.notes.all().map((note) => `- ${note.text}`).join('\n');
    return `Summarize these notes as ${style === 'bullets' ? 'a bulleted list' : 'one paragraph'}:\n\n${notes}`;
  }
}
