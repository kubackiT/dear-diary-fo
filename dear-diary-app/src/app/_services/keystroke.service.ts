import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const TRAIN_API = `${environment.apiHost}/api/train`;
const MODEL_API = `${environment.apiHost}/api/model`;
const RESEARCH_API = `${environment.apiHost}/api/research`;

interface MetricSummary {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
}

interface TypingSample {
  sampleType: 'enrollment' | 'verification';
  textLength: number;
  durationMs: number;
  keyCount: number;
  correctionCount: number;
  wordCount: number;
  burstCount: number;
  longPauseCount: number;
  overlapCount: number;
  dwell: MetricSummary;
  flight: MetricSummary;
  releasePress: MetricSummary;
  releaseRelease: MetricSummary;
  pause: MetricSummary;
  burst: MetricSummary;
  digraphs: Record<string, MetricSummary>;
  raw: {
    dwellTimes: number[];
    flightTimes: number[];
    releasePressTimes: number[];
    releaseReleaseTimes: number[];
    pauseTimes: number[];
    burstLengths: number[];
  };
}

export interface VerificationResult {
  isMatch: boolean;
  score: number | null;
  distance: number | null;
  threshold: number | null;
  sampleCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class KeystrokeService {
  private dwellTimes: number[] = [];
  private flightTimes: number[] = [];
  private releasePressTimes: number[] = [];
  private releaseReleaseTimes: number[] = [];
  private pauseTimes: number[] = [];
  private burstLengths: number[] = [];
  private currentBurstLength = 0;
  private digraphTimes = new Map<string, number[]>();
  private typedText = '';
  private correctionCount = 0;
  private keystrokesCount = 0;
  private firstTrackedTimestamp: number | null = null;
  private lastTrackedTimestamp: number | null = null;
  private lastTrackedKeydownTimestamp: number | null = null;
  private lastTrackedKeyCode: string | null = null;
  private lastTrackedKeyupTimestamp: number | null = null;
  private lastTrackedKeyupByCode = new Map<string, number>();
  private pendingReleasePressTransitions = new Map<string, Array<{ currentKeydownTimestamp: number }>>();
  private pendingReleaseReleaseTransitions = new Map<string, Array<{ currentCode: string }>>();
  private pendingReleaseReleaseByCurrentCode = new Map<string, Array<{ previousKeyupTimestamp: number }>>();
  private lastVerificationKeyCount = 0;
  private activeKeydowns = new Map<string, number>();
  private profileReady = false;
  private enrollmentInProgress = false;
  private researchMode: 'enrollment' | 'verification' = 'enrollment';
  private profileFrozen = false;

  private trainingThreshold = 1000;
  private verificationThreshold = 120;
  private verificationStep = 60;
  private longPauseThresholdMs = 2000;

  constructor(private http: HttpClient) {}

  recordKeystroke(event: KeyboardEvent, userId: string): void {
    if (!userId || !this.isTrackedKey(event)) {
      return;
    }

    if (this.firstTrackedTimestamp === null) {
      this.firstTrackedTimestamp = event.timeStamp;
    }
    this.lastTrackedTimestamp = event.timeStamp;

    if (event.type === 'keyup') {
      const keydownTimestamp = this.activeKeydowns.get(event.code);
      if (keydownTimestamp === undefined) {
        return;
      }

      const dwellTime = event.timeStamp - keydownTimestamp;
      this.activeKeydowns.delete(event.code);

      if (dwellTime >= 0) {
        this.dwellTimes.push(dwellTime);
        this.keystrokesCount++;
      }

      this.resolvePendingReleasePress(event.code, event.timeStamp);
      this.resolvePendingReleaseRelease(event.code, event.timeStamp);
      this.resolvePendingReleaseReleaseByCurrentCode(event.code, event.timeStamp);
      this.lastTrackedKeyupTimestamp = event.timeStamp;
      this.lastTrackedKeyupByCode.set(event.code, event.timeStamp);
    }

    if (event.type === 'keydown') {
      if (event.repeat) {
        return;
      }

      if (this.lastTrackedKeydownTimestamp !== null) {
        const flightTime = event.timeStamp - this.lastTrackedKeydownTimestamp;
        const previousCode = this.lastTrackedKeyCode;

        if (flightTime >= 0 && flightTime < this.longPauseThresholdMs) {
          this.flightTimes.push(flightTime);
          this.currentBurstLength++;
          this.recordDigraph(event.code, flightTime);
          this.recordReleasePress(previousCode, event.timeStamp);
          this.recordReleaseRelease(previousCode, event.code);
        }
        if (flightTime >= this.longPauseThresholdMs) {
          this.pauseTimes.push(flightTime);
          this.closeCurrentBurst();
        }
      } else {
        this.currentBurstLength = 1;
      }

      this.activeKeydowns.set(event.code, event.timeStamp);
      this.lastTrackedKeydownTimestamp = event.timeStamp;
      this.lastTrackedKeyCode = event.code;
      this.updateTypedText(event.key);
    }

    if (
      this.researchMode === 'enrollment'
      && !this.profileFrozen
      && this.keystrokesCount >= this.trainingThreshold
      && !this.enrollmentInProgress
    ) {
      this.saveEnrollmentSample(userId);
    }
  }

  loadUserModel(userId: string): Observable<boolean> {
    this.loadRuntimeConfig().subscribe();

    return this.http.get(`${MODEL_API}/${userId}`).pipe(
      tap(() => {
        this.profileReady = true;
      }),
      map(() => true),
      catchError(() => {
        this.profileReady = false;
        return of(false);
      })
    );
  }

  classifyUser(userId: string): Observable<VerificationResult | null> {
    if (!this.profileReady || this.keystrokesCount < this.verificationThreshold) {
      return of(null);
    }

    if (this.keystrokesCount - this.lastVerificationKeyCount < this.verificationStep) {
      return of(null);
    }

    this.lastVerificationKeyCount = this.keystrokesCount;
    const sample = this.buildSample('verification');

    return this.http.post<VerificationResult>(`${TRAIN_API}/verify`, { userId, sample }).pipe(
      catchError((error) => {
        console.error('Blad weryfikacji profilu pisania:', error);
        return of(null);
      })
    );
  }

  private loadRuntimeConfig(): Observable<boolean> {
    return this.http.get<any>(`${RESEARCH_API}/runtime-config`).pipe(
      tap((config) => {
        this.researchMode = config.mode || 'enrollment';
        this.profileFrozen = !!config.profileFrozen;
        this.trainingThreshold = config.sampleKeyThreshold || this.trainingThreshold;
        this.verificationThreshold = config.verificationKeyThreshold || this.verificationThreshold;
        this.verificationStep = config.verificationStep || this.verificationStep;
        this.longPauseThresholdMs = config.longPauseThresholdMs || this.longPauseThresholdMs;
      }),
      map(() => true),
      catchError((error) => {
        console.error('Blad pobierania konfiguracji badania:', error);
        return of(false);
      })
    );
  }

  private saveEnrollmentSample(userId: string): void {
    this.enrollmentInProgress = true;
    const sample = this.buildSample('enrollment');

    this.http.post(`${TRAIN_API}/training-data`, { userId, ...sample }).subscribe({
      next: () => {
        this.http.post(`${TRAIN_API}/${userId}`, {}).subscribe({
          next: () => {
            this.profileReady = true;
            this.resetSession();
            console.log(`Profil pisania uzytkownika ${userId} zostal zaktualizowany`);
          },
          error: (err) => {
            this.resetSession();
            console.error('Blad budowania profilu pisania:', err);
          }
        });
      },
      error: (err) => {
        this.resetSession();
        console.error('Blad wysylania danych pisania:', err);
      }
    });
  }

  private buildSample(sampleType: 'enrollment' | 'verification'): TypingSample {
    return {
      sampleType,
      textLength: this.typedText.length,
      durationMs: this.getDurationMs(),
      keyCount: this.keystrokesCount,
      correctionCount: this.correctionCount,
      wordCount: this.countWords(),
      burstCount: this.getBurstCount(),
      longPauseCount: this.pauseTimes.length,
      overlapCount: this.releasePressTimes.filter((time) => time < 0).length,
      dwell: this.summarize(this.dwellTimes),
      flight: this.summarize(this.flightTimes),
      releasePress: this.summarize(this.releasePressTimes),
      releaseRelease: this.summarize(this.releaseReleaseTimes),
      pause: this.summarize(this.pauseTimes),
      burst: this.summarize(this.getBurstLengthsForSample()),
      digraphs: this.summarizeDigraphs(),
      raw: {
        dwellTimes: [...this.dwellTimes],
        flightTimes: [...this.flightTimes],
        releasePressTimes: [...this.releasePressTimes],
        releaseReleaseTimes: [...this.releaseReleaseTimes],
        pauseTimes: [...this.pauseTimes],
        burstLengths: this.getBurstLengthsForSample()
      }
    };
  }

  private recordDigraph(currentCode: string, flightTime: number): void {
    const previousCode = this.lastTrackedKeyCode;
    if (!previousCode) {
      return;
    }

    const digraphKey = `${this.normalizeKeyCode(previousCode)}>${this.normalizeKeyCode(currentCode)}`;
    const times = this.digraphTimes.get(digraphKey) || [];
    times.push(flightTime);
    this.digraphTimes.set(digraphKey, times);
  }

  private recordReleasePress(previousCode: string | null, currentKeydownTimestamp: number): void {
    if (!previousCode) {
      return;
    }

    const previousKeyupTimestamp = this.lastTrackedKeyupByCode.get(previousCode);
    if (previousKeyupTimestamp !== undefined) {
      this.releasePressTimes.push(currentKeydownTimestamp - previousKeyupTimestamp);
      return;
    }

    const pending = this.pendingReleasePressTransitions.get(previousCode) || [];
    pending.push({ currentKeydownTimestamp });
    this.pendingReleasePressTransitions.set(previousCode, pending);
  }

  private recordReleaseRelease(previousCode: string | null, currentCode: string): void {
    if (!previousCode) {
      return;
    }

    const previousKeyupTimestamp = this.lastTrackedKeyupByCode.get(previousCode);
    const currentKeyupTimestamp = this.lastTrackedKeyupByCode.get(currentCode);
    if (previousKeyupTimestamp !== undefined && currentKeyupTimestamp !== undefined) {
      this.releaseReleaseTimes.push(currentKeyupTimestamp - previousKeyupTimestamp);
      return;
    }

    const pending = this.pendingReleaseReleaseTransitions.get(previousCode) || [];
    pending.push({ currentCode });
    this.pendingReleaseReleaseTransitions.set(previousCode, pending);
  }

  private resolvePendingReleasePress(code: string, keyupTimestamp: number): void {
    const pending = this.pendingReleasePressTransitions.get(code);
    if (!pending) {
      return;
    }

    pending.forEach((transition) => {
      this.releasePressTimes.push(transition.currentKeydownTimestamp - keyupTimestamp);
    });
    this.pendingReleasePressTransitions.delete(code);
  }

  private resolvePendingReleaseRelease(code: string, keyupTimestamp: number): void {
    const pending = this.pendingReleaseReleaseTransitions.get(code);
    if (!pending) {
      return;
    }

    pending.forEach((transition) => {
      const currentKeyupTimestamp = this.lastTrackedKeyupByCode.get(transition.currentCode);
      if (currentKeyupTimestamp === undefined) {
        const pendingByCurrent = this.pendingReleaseReleaseByCurrentCode.get(transition.currentCode) || [];
        pendingByCurrent.push({ previousKeyupTimestamp: keyupTimestamp });
        this.pendingReleaseReleaseByCurrentCode.set(transition.currentCode, pendingByCurrent);
        return;
      }

      this.releaseReleaseTimes.push(currentKeyupTimestamp - keyupTimestamp);
    });

    this.pendingReleaseReleaseTransitions.delete(code);
  }

  private resolvePendingReleaseReleaseByCurrentCode(code: string, keyupTimestamp: number): void {
    const pending = this.pendingReleaseReleaseByCurrentCode.get(code);
    if (!pending) {
      return;
    }

    pending.forEach((transition) => {
      this.releaseReleaseTimes.push(keyupTimestamp - transition.previousKeyupTimestamp);
    });
    this.pendingReleaseReleaseByCurrentCode.delete(code);
  }

  private closeCurrentBurst(): void {
    if (this.currentBurstLength > 0) {
      this.burstLengths.push(this.currentBurstLength);
      this.currentBurstLength = 1;
    }
  }

  private getBurstLengthsForSample(): number[] {
    const bursts = [...this.burstLengths];
    if (this.currentBurstLength > 0) {
      bursts.push(this.currentBurstLength);
    }

    return bursts;
  }

  private getBurstCount(): number {
    return this.getBurstLengthsForSample().length;
  }

  private countWords(): number {
    const words = this.typedText.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  private summarizeDigraphs(): Record<string, MetricSummary> {
    return Array.from(this.digraphTimes.entries()).reduce((result, [key, values]) => {
      result[key] = this.summarize(values);
      return result;
    }, {} as Record<string, MetricSummary>);
  }

  private normalizeKeyCode(code: string): string {
    return code
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace('Space', 'space')
      .replace('Backspace', 'backspace')
      .replace('Enter', 'enter')
      .toLowerCase();
  }

  private updateTypedText(key: string): void {
    if (key === 'Backspace') {
      this.typedText = this.typedText.slice(0, -1);
      this.correctionCount++;
    } else if (key.length === 1 || key === 'Enter') {
      this.typedText += key === 'Enter' ? '\n' : key;
    }
  }

  private summarize(values: number[]): MetricSummary {
    if (!values.length) {
      return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, count: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const midpoint = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
      : sorted[midpoint];
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;

    return {
      mean,
      median,
      stdDev: Math.sqrt(variance),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      count: values.length
    };
  }

  private getDurationMs(): number {
    if (this.firstTrackedTimestamp === null || this.lastTrackedTimestamp === null) {
      return 0;
    }

    return Math.max(0, this.lastTrackedTimestamp - this.firstTrackedTimestamp);
  }

  private resetSession(): void {
    this.dwellTimes = [];
    this.flightTimes = [];
    this.releasePressTimes = [];
    this.releaseReleaseTimes = [];
    this.pauseTimes = [];
    this.burstLengths = [];
    this.currentBurstLength = 0;
    this.digraphTimes.clear();
    this.typedText = '';
    this.correctionCount = 0;
    this.keystrokesCount = 0;
    this.firstTrackedTimestamp = null;
    this.lastTrackedTimestamp = null;
    this.lastTrackedKeydownTimestamp = null;
    this.lastTrackedKeyCode = null;
    this.lastTrackedKeyupTimestamp = null;
    this.lastTrackedKeyupByCode.clear();
    this.pendingReleasePressTransitions.clear();
    this.pendingReleaseReleaseTransitions.clear();
    this.pendingReleaseReleaseByCurrentCode.clear();
    this.lastVerificationKeyCount = 0;
    this.activeKeydowns.clear();
    this.enrollmentInProgress = false;
  }

  private isTrackedKey(event: KeyboardEvent): boolean {
    return event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter';
  }
}
