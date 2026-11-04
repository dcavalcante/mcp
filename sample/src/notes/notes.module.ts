import { Module } from '@nestjs/common';
import { NotesService } from './notes.service.js';
import { NotesTools } from './notes.tools.js';

@Module({ providers: [NotesService, NotesTools] })
export class NotesModule {}
