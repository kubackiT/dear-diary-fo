import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const API_URL = `${environment.apiHost}/api/user/`;
const RESEARCH_API = `${environment.apiHost}/api/research`;

@Injectable({
  providedIn: 'root',
})
export class UserService {
  constructor(private http: HttpClient) {}

  getPublicContent(): Observable<any> {
    return this.http.get(API_URL + 'all', { responseType: 'text' });
  }

  getUserBoard(): Observable<any> {
    return this.http.get(API_URL + 'user', { responseType: 'text' });
  }

  getAdminBoard(): Observable<any> {
    return this.http.get(API_URL + 'admin', { responseType: 'text' });
  }

  getResearchConfig(): Observable<any> {
    return this.http.get(`${RESEARCH_API}/config`);
  }

  updateResearchConfig(config: any): Observable<any> {
    return this.http.put(`${RESEARCH_API}/config`, config);
  }

  getResearchStats(userId?: string): Observable<any> {
    const options = userId ? { params: { userId } } : {};
    return this.http.get(`${RESEARCH_API}/stats`, options);
  }

  getResearchUsers(): Observable<any> {
    return this.http.get(`${RESEARCH_API}/users`);
  }

  updateResearchUserSettings(userId: string, settings: any): Observable<any> {
    return this.http.put(`${RESEARCH_API}/users/${userId}/settings`, settings);
  }

  freezeProfile(userId: string): Observable<any> {
    return this.http.post(`${RESEARCH_API}/freeze-profile`, { userId });
  }
}
