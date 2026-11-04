import { Injectable } from '@nestjs/common';

export interface Note {
  id: string;
  text: string;
  author: string;
}

@Injectable()
export class NotesService {
  private readonly notes = new Map<string, Note>();
  private next = 1;

  add(text: string, author: string): Note {
    const note = { id: String(this.next++), text, author };
    this.notes.set(note.id, note);
    return note;
  }

  find(id: string): Note | undefined {
    return this.notes.get(id);
  }

  search(query: string): Note[] {
    const needle = query.toLowerCase();
    return [...this.notes.values()].filter((note) => note.text.toLowerCase().includes(needle));
  }

  all(): Note[] {
    return [...this.notes.values()];
  }
}
