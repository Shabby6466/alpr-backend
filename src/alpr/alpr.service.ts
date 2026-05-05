import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RocService } from '../roc/roc.service';
import { EventsService } from '../events/events.service';
import { PersonsService } from '../persons/persons.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DetectPlateDto, DetectPlateFromUrlDto } from './dto/detect-plate.dto';
import { AlprResultDto, PlateDto, HealthDto, CombinedResultDto } from './dto/plate-result.dto';
import { normalizePlate } from '../common/plate.util';
import * as https from 'https';
import * as http from 'http';

@Injectable()
export class AlprService {
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

    for await (const result of this.roc.detectVideoFrames(
      file.buffer,
      params,
      params.frameStep ?? 15,
      file.originalname
    )) {
      yield* this.processCombinedFrame(result);
    }
  }

  async *detectLiveStream(
    url: string,
    params: DetectPlateDto,
  ): AsyncGenerator<CombinedResultDto> {
    if (!url) throw new BadRequestException('No stream URL provided');

    for await (const result of this.roc.detectStreamFrames(
      url,
      params,
      params.frameStep ?? 5,
    )) {
      yield* this.processCombinedFrame(result);
    }
  }

  private async *processCombinedFrame(
    result: any,
  ): AsyncGenerator<CombinedResultDto> {
    const start = Date.now();
    const [plates, faces] = await Promise.all([
      this.enrichPlates(result.plates),
      this.enrichFaces(result.faces),
    ]);

    for (const plate of plates) await this.logAndAlert(plate, 'video');
    // Faces are identified but not logged as "events" yet (unless we want to log face events too)

    yield {
      frameIndex: result.frameIndex,
      plates,
      faces,
      processingTimeMs: result.processingTimeMs + (Date.now() - start)
    };
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
          } catch (e) { }
        }
        const { template, ...faceRest } = r;
        return {
          ...faceRest,
          personName,
        };
      }),
    );
  }

  private async logAndAlert(plate: PlateDto, source: 'image' | 'video') {
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
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}
