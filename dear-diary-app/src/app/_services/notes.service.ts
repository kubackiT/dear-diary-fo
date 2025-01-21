import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StorageService } from './storage.service';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiHost}/api/notes`;

@Injectable({
  providedIn: 'root',
})
export class NotesService {
  constructor(private http: HttpClient, private storageService: StorageService) {}

  getAllNotes(): Observable<any> {
    return this.http.get(`${API_URL}`,{params: {userId: this.storageService.getUser().id}});
  }

  getNote(noteId: string): Observable<any> {
    return this.http.get(`${API_URL}/${noteId}`);
  }

  addNewNote(note: any): Observable<any> {
    const request = {...note, userId: this.storageService.getUser().id}
    return this.http.post(API_URL, request);
  }

  updateNote(noteId: string, note: any): Observable<any> {
    return this.http.put(`${API_URL}/${noteId}`, note);
  }

  deleteNote(noteId: string): Observable<any> {
    return this.http.delete(`${API_URL}/${noteId}`);
  }

}
