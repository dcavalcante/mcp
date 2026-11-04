import { Injectable } from '@nestjs/common';

@Injectable()
export class NotesService {
  private readonly notes = new Map<string, string>([['welcome', 'Read the docs first.']]);
  private next = 1;

  add(text: string): string {
    const id = `note-${this.next++}`;
    this.notes.set(id, text);
    return id;
  }

  get(id: string): string | undefined {
    return this.notes.get(id);
  }

  list(): { id: string; text: string }[] {
    return [...this.notes].map(([id, text]) => ({ id, text }));
  }

  get size(): number {
    return this.notes.size;
  }
}
