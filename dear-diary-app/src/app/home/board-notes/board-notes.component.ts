import { Component, OnInit } from '@angular/core';
import { NotesService } from '../../_services/notes.service';
import { Note } from '../../_models/note.model';

@Component({
  selector: 'app-board-notes',
  templateUrl: './board-notes.component.html',
  styleUrls: ['./board-notes.component.css']
})
export class BoardNotesComponent implements OnInit {
  notes: Note[] = [];

  constructor(private notesService: NotesService){}

  ngOnInit(): void {
    // Pobieranie danych z backendu
    this.notesService.getAllNotes().subscribe(data => {
      this.notes = data
      this.notes.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
    })
  }
}