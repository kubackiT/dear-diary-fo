import { Component, OnDestroy, OnInit } from '@angular/core';
import { NotesService } from '../../_services/notes.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Note } from '../../_models/note.model';
import { MatSnackBar } from '@angular/material/snack-bar';
import { KeystrokeService } from '../../_services/keystroke.service';
import { StorageService } from '../../_services/storage.service';

@Component({
  selector: 'app-board-notes-add',
  templateUrl: './board-notes-add.component.html',
  styleUrls: ['./board-notes-add.component.css']
})
export class BoardNotesAddComponent implements OnInit, OnDestroy{
  noteData: Note = {};

  noteId: string = '';

  userClassification: string = 'Brak analizy';

  isEditMode: boolean = false;

  form: any = {
    title: null,
    content: null
  };

  private routeSub: Subscription = Subscription.EMPTY;

  constructor(private storageService: StorageService, private route: ActivatedRoute, private router: Router, private notesService: NotesService, private toast: MatSnackBar, private keystrokeService: KeystrokeService){}

  ngOnInit(): void {
    this.routeSub = this.route.params.subscribe(params => {
      this.noteId = params['id'];
      this.isEditMode = !! this.noteId;
      if(this.isEditMode){
        this.getNote();
      }
    });
    const user = this.storageService.getUser();
    if (user && user.id) {
      this.keystrokeService.loadUserModel(user.id).subscribe();
    }
  }

  getNote(){
    this.notesService.getNote(this.noteId).subscribe(data => {
      this.noteData = data;
      this.form.title = data.title;
      this.form.content = data.content;
    })
  }
  ngOnDestroy() {
    this.routeSub.unsubscribe();
  }

  onSubmit(): void {
    if(this.isEditMode){
      this.notesService.updateNote(this.noteId,this.form).subscribe(() => {
        this.getNote()
      });
    }else{
      this.notesService.addNewNote(this.form).subscribe((data) => {
        this.toast.open(data.message,'Close',{horizontalPosition: 'right', duration: 4000});
        this.router.navigate(['/home']);
      });
    }
    
  }

  onDelete(): void {
    this.notesService.deleteNote(this.noteId,).subscribe((data) => {
      this.toast.open(data.message,'Close',{horizontalPosition: 'right', duration: 4000});
      this.router.navigate(['/home']);
    });
    
  }

  handleKeydown(event: KeyboardEvent) {
    this.keystrokeService.recordKeystroke(event, this.storageService.getUser().id);
  }

  handleKeyup(event: KeyboardEvent) {
    this.keystrokeService.recordKeystroke(event, this.storageService.getUser().id);

    this.keystrokeService.classifyUser(this.storageService.getUser().id).subscribe((verificationResult) => {
      if (verificationResult === null) {
        return;
      }

      if (verificationResult.score === null) {
        this.userClassification = 'Brak analizy';
        return;
      }

      const scorePercent = Math.round(verificationResult.score * 100);
      if (!verificationResult.isMatch) {
        this.userClassification = `Styl pisania rozni sie od profilu (${scorePercent}%)`;
      } else {
        this.userClassification = `Styl pisania zgodny z profilem (${scorePercent}%)`;
      }
    });
  }
}
