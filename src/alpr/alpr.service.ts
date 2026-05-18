import { Injectable, BadRequestException, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RocService } from '../roc/roc.service';
import { EventsService } from '../events/events.service';
import { PersonsService } from '../persons/persons.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FaceEventsService } from '../face-events/face-events.service';
import { JourneysService } from '../journeys/journeys.service';
import { DetectPlateDto, DetectPlateFromUrlDto } from './dto/detect-plate.dto';
import { AlprResultDto, PlateDto, FaceDto, VehicleDto, HealthDto, CombinedResultDto } from './dto/plate-result.dto';
import { normalizePlate, isValidPakistaniPlate } from '../common/plate.util';
import { PlateTracker } from '../common/plate-tracker';
import { VehicleTracker } from '../common/vehicle-tracker';
import * as https from 'https';
import * as http from 'http';

const MIN_PLATE_PX_WIDTH = 40;
const PLATE_COOLDOWN_MS = 30_000;
const SESSION_TTL_MS = 120_000; // auto-expire sessions idle for 2 minutes

interface VideoSession {
  tracker: VehicleTracker;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class AlprService implements OnModuleDestroy {
  private readonly logger = new Logger(AlprService.name);
  // 8s idle window, edit distance ≤2, require ≥3 observations before committing
  private readonly tracker = new PlateTracker(8_000, 2, 3);
  private readonly recentlyLogged = new Map<string, number>();
  private readonly videoSessions = new Map<string, VideoSession>();

  constructor(
    private readonly roc: RocService,
    private readonly eventsService: EventsService,
    private readonly personsService: PersonsService,
    private readonly watchlistService: WatchlistService,
    private readonly notifications: NotificationsService,
    private readonly faceEvents: FaceEventsService,
    private readonly journeys: JourneysService,
    private readonly config: ConfigService,
  ) {}

  onModuleDestroy() {
    for (const { timer } of this.videoSessions.values()) clearTimeout(timer);
    this.videoSessions.clear();
  }

  // ── Video session management ────────────────────────────────────────────────

  private getOrCreateSession(sessionId: string): VehicleTracker {
    const existing = this.videoSessions.get(sessionId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.expireSession(sessionId), SESSION_TTL_MS);
      return existing.tracker;
    }
    const tracker = new VehicleTracker(8_000, 1);
    const timer = setTimeout(() => this.expireSession(sessionId), SESSION_TTL_MS);
    this.videoSessions.set(sessionId, { tracker, timer });
    return tracker;
  }

  private async expireSession(sessionId: string) {
    const session = this.videoSessions.get(sessionId);
    if (!session) return;
    this.videoSessions.delete(sessionId);
    clearTimeout(session.timer);
    for (const plate of session.tracker.flushAll()) {
      await this.logAndAlert(plate, 'video');
    }
    this.logger.log(`Session ${sessionId} auto-expired`);
  }

  /** Flush a video session: commit one best event per tracked vehicle, return them. */
  async flushVideoSession(sessionId: string): Promise<PlateDto[]> {
    const session = this.videoSessions.get(sessionId);
    if (!session) return [];
    this.videoSessions.delete(sessionId);
    clearTimeout(session.timer);
    const plates = session.tracker.flushAll();
    for (const plate of plates) {
      await this.logAndAlert(plate, 'video');
    }
    this.logger.log(`Session ${sessionId} flushed — ${plates.length} vehicle(s) committed`);
    return plates;
  }

  // ── Detection entry points ──────────────────────────────────────────────────

  async detectFromFile(file: Express.Multer.File, params: DetectPlateDto): Promise<AlprResultDto> {
    if (!file) throw new BadRequestException('No image file provided');
    const start = Date.now();
    const [platesRaw, facesRaw, { vehicles: vehiclesRaw, hasGun }] = await Promise.all([
      this.roc.detectLicensePlates({ image: file.buffer, ...params }),
      this.roc.detectFaces(file.buffer),
      this.roc.detectObjectsFromBuffer(file.buffer),
    ]);

    if (params.sessionId) {
      // Session mode: accumulate into tracker, don't log yet
      return this.processIntoSession(
        params.sessionId, platesRaw, facesRaw, vehiclesRaw, hasGun, Date.now() - start,
      );
    }
    return this.processAndLog(platesRaw, facesRaw, vehiclesRaw, hasGun, 'image', Date.now() - start);
  }

  private async processIntoSession(
    sessionId: string,
    rawPlates: any[], rawFaces: any[], rawVehicles: any[],
    hasGun: boolean, processingTimeMs: number,
  ): Promise<AlprResultDto> {
    const [plates, faces, vehicles] = await Promise.all([
      this.enrichPlates(rawPlates, rawVehicles),
      this.enrichFaces(rawFaces),
      Promise.resolve(this.mapVehicles(rawVehicles)),
    ]);

    if (hasGun) this.notifications.emitGunAlert({ timestamp: new Date(), source: 'video' });

    const validPlates = plates.filter(p =>
      this.passesPreFilters({ text: p.text, boundingBox: p.boundingBox, confidence: p.confidence }),
    );

    const tracker = this.getOrCreateSession(sessionId);
    for (const plate of validPlates) {
      tracker.observe(plate);
    }

    // Return only valid plates — feed and overlay show the same set that enters the tracker
    return { success: true, count: validPlates.length + faces.length, plates: validPlates, faces, vehicles, processingTimeMs, gunDetected: hasGun };
  }

  async detectFromUrl(dto: DetectPlateFromUrlDto): Promise<AlprResultDto> {
    const start = Date.now();
    const { imageUrl, ...params } = dto;
    const imageBuffer = await this.fetchUrl(imageUrl);
    const [platesRaw, facesRaw, { vehicles: vehiclesRaw, hasGun }] = await Promise.all([
      this.roc.detectLicensePlates({ image: imageBuffer, ...params }),
      this.roc.detectFaces(imageBuffer),
      this.roc.detectObjectsFromBuffer(imageBuffer),
    ]);
    return this.processAndLog(platesRaw, facesRaw, vehiclesRaw, hasGun, 'image', Date.now() - start);
  }

  async *detectVideoStream(
    file: Express.Multer.File,
    params: DetectPlateDto,
  ): AsyncGenerator<CombinedResultDto> {
    if (!file) throw new BadRequestException('No video file provided');
    try {
      for await (const result of this.roc.detectVideoFrames(
        file.buffer,
        params,
        params.frameStep ?? 5,
        file.originalname,
      )) {
        yield* this.processCombinedFrame(result, 'video');
      }
    } finally {
      await this.flushTracker('video');
    }
  }

  /**
   * Used both by the controller (one-shot SSE) and CameraWorkerService (persistent loop).
   * cameraId/cameraName are populated by camera workers; null for direct API calls.
   */
  async *testCameraWithVideo(
    camera: { id: string; name: string; region?: string; frameStep?: number },
    file: Express.Multer.File,
  ): AsyncGenerator<CombinedResultDto> {
    if (!file) throw new BadRequestException('No video file provided');
    const params: DetectPlateDto = {
      region: (camera.region ?? 'NORTH_AMERICAN') as any,
      frameStep: camera.frameStep ?? 5,
      thumbnail: true,
      ignorePartial: false,
    };
    try {
      for await (const result of this.roc.detectVideoFrames(
        file.buffer, params, params.frameStep ?? 5, file.originalname,
      )) {
        yield* this.processCombinedFrame(result, 'camera', camera.id, camera.name);
      }
    } finally {
      await this.flushTracker('camera', camera.id, camera.name);
    }
  }

  async *detectLiveStream(
    url: string,
    params: DetectPlateDto,
    cameraId?: string,
    cameraName?: string,
  ): AsyncGenerator<CombinedResultDto> {
    if (!url) throw new BadRequestException('No stream URL provided');
    const source = cameraId ? 'camera' : 'stream';
    try {
      for await (const result of this.roc.detectStreamFrames(
        url,
        params,
        params.frameStep ?? 5,
      )) {
        yield* this.processCombinedFrame(result, source as any, cameraId, cameraName);
      }
    } finally {
      await this.flushTracker(source as any, cameraId, cameraName);
    }
  }

  private async *processCombinedFrame(
    result: any,
    source: 'video' | 'stream' | 'camera',
    cameraId?: string,
    cameraName?: string,
  ): AsyncGenerator<CombinedResultDto> {
    const start = Date.now();

    const filteredRaw = result.plates.filter((r: any) => this.passesPreFilters(r));

    const [plates, faces, vehicles] = await Promise.all([
      this.enrichPlates(filteredRaw, result.vehicles),
      this.enrichFaces(result.faces),
      Promise.resolve(this.mapVehicles(result.vehicles)),
    ]);

    // Gun alert — emit immediately, no DB write needed
    if (result.hasGun) {
      const gunPayload = { cameraId, cameraName, timestamp: new Date(), frameIndex: result.frameIndex };
      this.notifications.emitGunAlert(gunPayload);
      this.logger.warn(`GUN DETECTED — camera: ${cameraName ?? 'manual'}, frame: ${result.frameIndex}`);
    }

    // Feed plates into tracker; commit sessions that have been idle
    for (const plate of plates) {
      const committed = this.tracker.observe(plate);
      for (const winner of committed) {
        await this.logCommitted(winner, source, cameraId, cameraName, result.hasGun);
      }
    }

    if (this.config.get<boolean>('features.persistFaceEvents') && faces.length > 0) {
      for (const face of faces) {
        await this.faceEvents.create({
          personId: face.personId,
          personName: face.personName,
          confidence: face.confidence,
          quality: face.quality,
          spoofScore: face.spoofScore,
          spoofDetected: face.spoofDetected ?? false,
          occluded: face.occluded ?? false,
          thumbnailBase64: face.thumbnail,
          cameraId,
          cameraName,
          x: face.boundingBox?.x ?? 0,
          y: face.boundingBox?.y ?? 0,
          width: face.boundingBox?.width ?? 0,
          height: face.boundingBox?.height ?? 0,
        }).catch(err => this.logger.warn(`FaceEvent save failed: ${err.message}`));
      }
    }

    yield {
      frameIndex: result.frameIndex,
      plates,
      faces,
      vehicles,
      processingTimeMs: result.processingTimeMs + (Date.now() - start),
      gunDetected: result.hasGun,
    };
  }

  private async flushTracker(
    source: 'video' | 'stream' | 'camera',
    cameraId?: string,
    cameraName?: string,
  ) {
    for (const winner of this.tracker.flushAll()) {
      await this.logCommitted(winner, source, cameraId, cameraName, false);
    }
  }

  private async logCommitted(
    plate: PlateDto,
    source: 'video' | 'stream' | 'camera',
    cameraId?: string,
    cameraName?: string,
    gunDetected = false,
  ) {
    const now = Date.now();
    // Cooldown is per plate+camera — same plate at a different camera always logs
    // (cross-camera hop must not be suppressed by the cooldown)
    const cooldownKey = `${plate.text}:${cameraId ?? ''}`;
    const last = this.recentlyLogged.get(cooldownKey);
    if (last !== undefined && now - last < PLATE_COOLDOWN_MS) return;

    this.recentlyLogged.set(cooldownKey, now);
    if (this.recentlyLogged.size > 500) {
      for (const [k, t] of this.recentlyLogged) {
        if (now - t > PLATE_COOLDOWN_MS) this.recentlyLogged.delete(k);
      }
    }

    await this.logAndAlert(plate, source, cameraId, cameraName, gunDetected);
  }

  private passesPreFilters(raw: any): boolean {
    const w = raw.boundingBox?.width ?? 0;
    const h = raw.boundingBox?.height ?? 1;
    const text = raw.text ?? '';
    const conf = raw.confidence ?? 0;
    const ratio = w / h;

    if (w < MIN_PLATE_PX_WIDTH) {
      this.logger.debug(`SKIP [too narrow] "${text}" w=${w}px`);
      return false;
    }
    if (conf < 0.65) {
      this.logger.debug(`SKIP [low confidence] "${text}" conf=${conf.toFixed(2)}`);
      return false;
    }
    // Block portrait shapes (badges, logos). Threshold 1.1 allows:
    //  - New-format Pakistani green plates (two-line stacked, ~1.0–1.3 ratio)
    //  - Motorcycle plates (narrow, ~1.2–1.5 ratio)
    //  - Angled shots of standard plates
    // Pakistani regex is the primary false-positive gate; aspect ratio just blocks
    // clearly-portrait shapes that can't be plates.
    if (ratio < 1.1) {
      this.logger.debug(`SKIP [portrait] "${text}" w/h=${ratio.toFixed(2)}`);
      return false;
    }
    const normalized = normalizePlate(text);
    if (!isValidPakistaniPlate(normalized)) {
      this.logger.debug(`SKIP [regex] "${text}" → "${normalized}"`);
      return false;
    }
    return true;
  }

  health(): HealthDto {
    const modelPath = this.config.get<string>('roc.modelPath');
    const initialized = this.roc.ping();
    return {
      status: initialized ? 'ok' : 'error',
      rocInitialized: initialized,
      modelPath,
      capabilities: this.roc.capabilities(),
      ...(!initialized && { error: 'ROC SDK not initialized' }),
    };
  }

  private async processAndLog(
    rawPlates: any[],
    rawFaces: any[],
    rawVehicles: any[],
    hasGun: boolean,
    source: 'image' | 'video',
    processingTimeMs: number,
  ): Promise<AlprResultDto> {
    const [plates, faces, vehicles] = await Promise.all([
      this.enrichPlates(rawPlates, rawVehicles),
      this.enrichFaces(rawFaces),
      Promise.resolve(this.mapVehicles(rawVehicles)),
    ]);

    if (hasGun) {
      this.notifications.emitGunAlert({ timestamp: new Date(), source });
      this.logger.warn('GUN DETECTED in uploaded image/video');
    }

    for (const plate of plates) {
      await this.logAndAlert(plate, source, undefined, undefined, hasGun);
    }

    if (this.config.get<boolean>('features.persistFaceEvents') && faces.length > 0) {
      for (const face of faces) {
        await this.faceEvents.create({
          personId: face.personId,
          personName: face.personName,
          confidence: face.confidence,
          quality: face.quality,
          spoofScore: face.spoofScore,
          spoofDetected: face.spoofDetected ?? false,
          occluded: face.occluded ?? false,
          thumbnailBase64: face.thumbnail,
          x: face.boundingBox?.x ?? 0,
          y: face.boundingBox?.y ?? 0,
          width: face.boundingBox?.width ?? 0,
          height: face.boundingBox?.height ?? 0,
        }).catch(err => this.logger.warn(`FaceEvent save failed: ${err.message}`));
      }
    }

    return {
      success: true,
      count: plates.length + faces.length,
      plates,
      faces,
      vehicles,
      processingTimeMs,
      gunDetected: hasGun,
    };
  }

  private mapVehicles(raw: any[]): VehicleDto[] {
    return (raw ?? []).map(v => ({
      make: v.make,
      model: v.model,
      color: v.color,
      confidence: v.confidence,
      boundingBox: v.boundingBox,
      thumbnail: v.thumbnail,
    }));
  }

  private async enrichPlates(raw: any[], vehicles: any[] = []): Promise<PlateDto[]> {
    // Pick the best vehicle match: highest confidence vehicle in the frame
    const bestVehicle = vehicles?.length
      ? vehicles.reduce((best, v) => v.confidence > best.confidence ? v : best, vehicles[0])
      : null;

    return Promise.all(
      raw.map(async (r) => {
        const person = await this.personsService.findByPlate(r.text);
        return {
          text: normalizePlate(r.text),
          confidence: r.confidence,
          quality: r.quality,
          boundingBox: r.boundingBox,
          thumbnail: r.thumbnail,
          region: r.region,
          state: r.state,
          personId: person?.id,
          personName: person?.name,
          vehicleMake: bestVehicle?.make,
          vehicleModel: bestVehicle?.model,
          vehicleColor: bestVehicle?.color,
          vehicleThumbnail: bestVehicle?.thumbnail,
        };
      }),
    );
  }

  private async enrichFaces(raw: any[]): Promise<FaceDto[]> {
    return Promise.all(
      raw.map(async (r) => {
        let personName: string | undefined;
        if (r.personId) {
          try {
            const p = await this.personsService.findOne(r.personId);
            personName = p.name;
          } catch {
            // person may have been deleted
          }
        }
        const { template, ...faceRest } = r;
        return { ...faceRest, personName };
      }),
    );
  }

  private async logAndAlert(
    plate: PlateDto,
    source: 'image' | 'video' | 'stream' | 'camera',
    cameraId?: string,
    cameraName?: string,
    gunDetected = false,
  ) {
    const event = await this.eventsService.create({
      plateText: plate.text,
      confidence: plate.confidence,
      source,
      personId: plate.personId,
      personName: plate.personName,
      thumbnailBase64: plate.thumbnail,
      x: plate.boundingBox.x,
      y: plate.boundingBox.y,
      width: plate.boundingBox.width,
      height: plate.boundingBox.height,
      vehicleMake: plate.vehicleMake,
      vehicleModel: plate.vehicleModel,
      vehicleColor: plate.vehicleColor,
      vehicleThumbnail: plate.vehicleThumbnail,
      direction: plate.direction,
      cameraId,
      cameraName,
      gunDetected,
    });

    this.notifications.emitEvent({ ...event, personName: plate.personName });
    await this.watchlistService.checkAndAlert(plate.text, event.id, plate.thumbnail);

    if (cameraId) {
      await this.journeys.recordSighting({
        plateText: plate.text,
        cameraId,
        cameraName,
        thumbnailBase64: plate.thumbnail,
        confidence: plate.confidence,
        detectionEventId: event.id,
      });
    }
  }

  private fetchUrl(url: string): Promise<Buffer> {
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new BadRequestException('Invalid URL'); }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Only HTTP/HTTPS URLs are allowed');
    }

    const hostname = parsed.hostname.toLowerCase();
    const blocked = ['localhost', '0.0.0.0', '169.254.169.254', '100.100.100.200'];
    if (
      blocked.includes(hostname) ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname)
    ) {
      throw new BadRequestException('Private/loopback addresses are not allowed');
    }

    const maxBytes = (this.config.get<number>('upload.maxFileSizeMb') ?? 20) * 1024 * 1024;

    return new Promise((resolve, reject) => {
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(url, { timeout: 30_000 }, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy();
            return reject(new BadRequestException(`Response exceeds ${maxBytes / 1024 / 1024}MB limit`));
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new BadRequestException('URL fetch timed out')); });
      req.on('error', reject);
    });
  }
}
