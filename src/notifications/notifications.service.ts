import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface SseMessage {
  data: any;
  type?: string;
}

@Injectable()
export class NotificationsService {
  private eventStream$ = new Subject<SseMessage>();
  private alertStream$ = new Subject<SseMessage>();
  private gunStream$ = new Subject<SseMessage>();
  private faceStream$ = new Subject<SseMessage>();

  get events$() { return this.eventStream$.asObservable(); }
  get alerts$() { return this.alertStream$.asObservable(); }
  get guns$() { return this.gunStream$.asObservable(); }
  get faces$() { return this.faceStream$.asObservable(); }

  emitEvent(data: any) {
    this.eventStream$.next({ data, type: 'detection' });
  }

  emitAlert(data: any) {
    this.alertStream$.next({ data, type: 'alert' });
  }

  emitGunAlert(data: any) {
    this.gunStream$.next({ data, type: 'gun' });
  }

  emitFaceEvent(data: any) {
    this.faceStream$.next({ data, type: 'face' });
  }
}
