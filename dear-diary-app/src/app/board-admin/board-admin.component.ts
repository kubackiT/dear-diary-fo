import { Component, OnInit } from '@angular/core';
import { UserService } from '../_services/user.service';
import { StorageService } from '../_services/storage.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-board-admin',
  templateUrl: './board-admin.component.html',
  styleUrls: ['./board-admin.component.css']
})
export class BoardAdminComponent implements OnInit {
  content?: string;
  config: any = null;
  stats: any = null;
  users: any[] = [];
  selectedUserId = '';
  isLoading = false;
  currentUserId = '';

  get latestVerificationSamples(): any[] {
    return (this.stats?.lastSamples || []).filter((sample: any) => sample.sampleType === 'verification');
  }

  constructor(
    private userService: UserService,
    private storageService: StorageService,
    private toast: MatSnackBar
  ) { }

  ngOnInit(): void {
    const user = this.storageService.getUser();
    this.currentUserId = user?.id || '';
    this.selectedUserId = this.currentUserId;

    this.userService.getAdminBoard().subscribe({
      next: data => {
        this.content = data;
        this.loadResearchData();
      },
      error: err => {
        if (err.error) {
          try {
            const res = JSON.parse(err.error);
            this.content = res.message;
          } catch {
            this.content = `Error with status: ${err.status} - ${err.statusText}`;
          }
        } else {
          this.content = `Error with status: ${err.status}`;
        }
      }
    });
  }

  loadResearchData(): void {
    this.isLoading = true;

    this.userService.getResearchConfig().subscribe({
      next: config => {
        this.config = config;
        this.loadUsers();
      },
      error: err => {
        this.isLoading = false;
        this.toast.open(err.error?.message || err.error?.error || 'Research config error', 'Close', { duration: 4000 });
      }
    });
  }

  loadUsers(): void {
    this.userService.getResearchUsers().subscribe({
      next: users => {
        this.users = users;

        if (!this.selectedUserId && this.users.length) {
          this.selectedUserId = this.users[0].id;
        }

        this.loadStats();
      },
      error: err => {
        this.isLoading = false;
        this.toast.open(err.error?.message || err.error?.error || 'Research users error', 'Close', { duration: 4000 });
      }
    });
  }

  loadStats(): void {
    this.userService.getResearchStats(this.selectedUserId).subscribe({
      next: stats => {
        this.stats = stats;
        this.isLoading = false;
      },
      error: err => {
        this.isLoading = false;
        this.toast.open(err.error?.message || err.error?.error || 'Research stats error', 'Close', { duration: 4000 });
      }
    });
  }

  onSelectedUserChange(): void {
    this.loadStats();
  }

  onActorTypeChange(actorType: string): void {
    if (!this.selectedUserId) {
      return;
    }

    this.userService.updateResearchUserSettings(this.selectedUserId, {
      currentActorType: actorType
    }).subscribe({
      next: updatedUser => {
        this.users = this.users.map(user => {
          if (user.id !== this.selectedUserId) {
            return user;
          }

          return {
            ...user,
            researchSettings: updatedUser.researchSettings
          };
        });
        this.toast.open('Actor type saved', 'Close', { duration: 2500 });
      },
      error: err => this.toast.open(err.error?.message || err.error?.error || 'Actor type save error', 'Close', { duration: 4000 })
    });
  }

  saveConfig(): void {
    if (!this.config) {
      return;
    }

    this.userService.updateResearchConfig({
      mode: this.config.mode,
      profileUpdatesEnabled: this.config.profileUpdatesEnabled,
      profileFrozen: this.config.profileFrozen,
      minEnrollmentSamples: Number(this.config.minEnrollmentSamples),
      sampleKeyThreshold: Number(this.config.sampleKeyThreshold),
      verificationKeyThreshold: Number(this.config.verificationKeyThreshold),
      verificationStep: Number(this.config.verificationStep),
      longPauseThresholdMs: Number(this.config.longPauseThresholdMs),
      maxDigraphFeatures: Number(this.config.maxDigraphFeatures)
    }).subscribe({
      next: config => {
        this.config = config;
        this.toast.open('Research config saved', 'Close', { duration: 3000 });
        this.loadStats();
      },
      error: err => this.toast.open(err.error?.message || err.error?.error || 'Config save error', 'Close', { duration: 4000 })
    });
  }

  freezeProfile(): void {
    if (!this.selectedUserId) {
      return;
    }

    this.userService.freezeProfile(this.selectedUserId).subscribe({
      next: response => {
        this.config = response.config;
        this.toast.open('Profile frozen', 'Close', { duration: 3000 });
        this.loadStats();
      },
      error: err => this.toast.open(err.error?.message || err.error?.error || 'Freeze profile error', 'Close', { duration: 4000 })
    });
  }

  get selectedUser(): any {
    return this.users.find((user) => user.id === this.selectedUserId);
  }

  formatScore(score: number | null | undefined): string {
    if (score === null || score === undefined) {
      return '-';
    }

    return `${Math.round(score * 100)}%`;
  }

  formatDistance(distance: number | null | undefined): string {
    if (distance === null || distance === undefined) {
      return '-';
    }

    return distance.toFixed(2);
  }

  formatActorType(actorType: string | null | undefined): string {
    return actorType || 'owner';
  }
}
