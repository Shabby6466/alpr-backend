import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RocService } from '../roc/roc.service';
import { EventsService } from '../events/events.service';
import { PersonsService } from '../persons/persons.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DetectPlateDto, DetectPlateFromUrlDto } from './dto/detect-plate.dto';
import { AlprResultDto, PlateDto, HealthDto, CombinedResultDto } from './dto/plate-result.dto';
import { normalizePlate, isValidPakistaniPlate } from '../common/plate.util';
import { PlateTracker } from '../common/plate-tracker';
import * as https from 'https';
import * as http from 'http';

/** Plate bounding box must be at least this wide (pixels) before OCR is trusted. */
const MIN_PLATE_PX_WIDTH = 60;

/** How long (ms) to suppress re-logging a plate that was just committed. */
const PLATE_COOLDOWN_MS = 30_000;

@Injectable()
export class AlprService {
  private readonly logger = new Logger(AlprService.name);
  private readonly tracker = new PlateTracker(5_000, 2);
  private readonly recentlyLogged = new Map<string, number>(); // plateText → timestamp

  constructor(
    private readonly roc: RocService,
    private readonly eventsService: EventsService,
    private readonly personsService: PersonsService,
    private readonly watchlistService: WatchlistService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) { }

  async detectFromFile(file: Express.Multer.File, params: DetectPlateDto): Promise<AlprResultDto> {
    if (!file) throw new BadRequestException('No image file provided');
    const start = Date.now();
    const [platesRaw, facesRaw] = await Promise.all([
      this.roc.detectLicensePlates({ image: file.buffer, ...params }),
      this.roc.detectFaces(file.buffer),
    ]);
    return this.processAndLog(platesRaw, facesRaw, 'image', Date.now() - start);
  }

  async detectFromUrl(dto: DetectPlateFromUrlDto): Promise<AlprResultDto> {
    const start = Date.now();
    const { imageUrl, ...params } = dto;
    const imageBuffer = await this.fetchUrl(imageUrl);
    const [platesRaw, facesRaw] = await Promise.all([
      this.roc.detectLicensePlates({ image: imageBuffer, ...params }),
      this.roc.detectFaces(imageBuffer),
    ]);
    return this.processAndLog(platesRaw, facesRaw, 'image', Date.now() - start);
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
        params.frameStep ?? 15,
        file.originalname,
      )) {
        yield* this.processCombinedFrame(result);
      }
    } finally {
      await this.flushTracker('video');
    }
  }

  async *detectLiveStream(
    url: string,
    params: DetectPlateDto,
  ): AsyncGenerator<CombinedResultDto> {
    if (!url) throw new BadRequestException('No stream URL provided');

    try {
      for await (const result of this.roc.detectStreamFrames(
        url,
        params,
        params.frameStep ?? 5,
      )) {
        yield* this.processCombinedFrame(result);
      }
    } finally {
      await this.flushTracker('stream');
    }
  }

  private async *processCombinedFrame(
    result: any,
  ): AsyncGenerator<CombinedResultDto> {
    const start = Date.now();

    // Pre-filter raw plates before enrichment: skip tiny/distant plates and regex failures
    const filteredRaw = result.plates.filter((r: any) => this.passesPreFilters(r));

    const [plates, faces] = await Promise.all([
      this.enrichPlates(filteredRaw),
      this.enrichFaces(result.faces),
    ]);

    // Feed filtered plates into the tracker; log sessions that have just expired
    for (const plate of plates) {
      const committed = this.tracker.observe(plate);
      for (const winner of committed) await this.logCommitted(winner, 'video');
    }

    yield {
      frameIndex: result.frameIndex,
      plates,
      faces,
      processingTimeMs: result.processingTimeMs + (Date.now() - start),
    };
  }

  /** Flush remaining open sessions when a video stream ends. */
  private async flushTracker(source: 'video' | 'stream') {
    for (const winner of this.tracker.flushAll()) {
      await this.logCommitted(winner, source);
    }
  }

  /**
   * Log a committed (voted) plate to the DB and fire SSE/watchlist alerts.
   * Suppressed if the same plate was logged within PLATE_COOLDOWN_MS.
   */
  private async logCommitted(plate: PlateDto, source: 'video' | 'stream') {
    const now = Date.now();
    const last = this.recentlyLogged.get(plate.text);
    if (last !== undefined && now - last < PLATE_COOLDOWN_MS) return;

    this.recentlyLogged.set(plate.text, now);
    // Evict stale cooldown entries to avoid memory growth on long-running streams
    if (this.recentlyLogged.size > 500) {
      for (const [k, t] of this.recentlyLogged) {
        if (now - t > PLATE_COOLDOWN_MS) this.recentlyLogged.delete(k);
      }
    }

    await this.logAndAlert(plate, source);
  }

  /** True when the raw plate result is worth processing further. */
  private passesPreFilters(raw: any): boolean {
    if ((raw.boundingBox?.width ?? 0) < MIN_PLATE_PX_WIDTH) return false;
    const normalized = normalizePlate(raw.text ?? '');
    return isValidPakistaniPlate(normalized);
  }

  health(): HealthDto {
    const modelPath = this.config.get<string>('roc.modelPath');
    const initialized = this.roc.ping();
    return {
      status: initialized ? 'ok' : 'error',
      rocInitialized: initialized,
      modelPath,
      ...(!initialized && { error: 'ROC SDK not initialized' }),
    };
  }

  private async processAndLog(rawPlates: any[], rawFaces: any[], source: 'image' | 'video', processingTimeMs: number): Promise<AlprResultDto> {
    const [plates, faces] = await Promise.all([
      this.enrichPlates(rawPlates),
      this.enrichFaces(rawFaces),
    ]);
    for (const plate of plates) {
      await this.logAndAlert(plate, source);
    }
    return { success: true, count: plates.length + faces.length, plates, faces, processingTimeMs };
  }

  private async enrichPlates(raw: any[]): Promise<PlateDto[]> {
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
        };
      }),
    );
  }

  private async enrichFaces(raw: any[]): Promise<any[]> {
    return Promise.all(
      raw.map(async (r) => {
        let personName = undefined;
        if (r.personId) {
          try {
            const p = await this.personsService.findOne(r.personId);
            personName = p.name;
          } catch (e) {
            this.logger.warn(`Could not resolve person name for id ${r.personId}: ${e.message}`);
          }
        }
        const { template, ...faceRest } = r;
        return {
          ...faceRest,
          personName,
        };
      }),
    );
  }

  private async logAndAlert(plate: PlateDto, source: 'image' | 'video' | 'stream') {
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
    });

    this.notifications.emitEvent({ ...event, personName: plate.personName });
    await this.watchlistService.checkAndAlert(plate.text, event.id, plate.thumbnail);
  }

  private fetchUrl(url: string): Promise<Buffer> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

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
