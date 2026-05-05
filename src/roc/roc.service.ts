import { Injectable, Logger, OnModuleDestroy, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const roc = require(path.resolve(process.cwd(), 'roc.node'));

export interface LprDetectOptions {
  image?: Buffer;
  maxPlates?: number;
  minQuality?: number;
  relativeMinSize?: number;
  region?: 'NORTH_AMERICAN' | 'EUROPEAN' | 'PACIFIC';
  thumbnail?: boolean;
  ignorePartial?: boolean;
  degrees?: number;
  falseDetectionRate?: number;
  textFilter?: string;
}

export interface RawPlateResult {
  text: string;
  confidence: number;
  quality: number;
  state?: string;
  boundingBox: { x: number; y: number; width: number; height: number; rotation: number };
  thumbnail?: string;
  region?: string;
}

export interface RawFaceResult {
  confidence: number;
  quality: number;
  boundingBox: { x: number; y: number; width: number; height: number; rotation: number };
  thumbnail?: string;
  template: Buffer;
  personId?: string; // If found in gallery
  similarity?: number;
}

export interface CombinedResult {
  frameIndex: number;
  plates: RawPlateResult[];
  faces: RawFaceResult[];
  processingTimeMs: number;
}

@Injectable()
export class RocService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RocService.name);
  private initialized = false;
  private gallery: any;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) { }

  async onModuleInit() {
    await this.ensureInitialized();
  }

  async ensureInitialized() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const modelPath = this.config.get<string>('roc.modelPath');
        roc.roc_initialize(null);
        roc.roc_set_model_path(modelPath);
        this.gallery = await roc.roc_open_gallery(null); // RAM gallery
        this.initialized = true;
        this.logger.log(`ROC SDK initialized with Face Gallery, model path: ${modelPath}`);
      } catch (err) {
        this.initPromise = null;
        this.logger.error(`ROC SDK initialization failed: ${err.message}`);
        throw err;
      }
    })();

    return this.initPromise;
  }

  onModuleDestroy() {
    if (this.initialized) {
      roc.roc_finalize();
      this.logger.log('ROC SDK finalized');
    }
  }

  async detectLicensePlates(options: LprDetectOptions): Promise<RawPlateResult[]> {
    await this.ensureInitialized();
    if (!options.image || options.image.length === 0) {
      throw new InternalServerErrorException('No image data provided');
    }

    const tmpPath = path.join(os.tmpdir(), `roc-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    fs.writeFileSync(tmpPath, options.image);
    try {
      const image = await roc.roc_read_image(tmpPath, roc.ROC_BGR24);
      return await this.runLpr(image, options);
    } catch (err) {
      this.logger.error('LPR detection failed', err?.message);
      throw new InternalServerErrorException(`ROC LPR error: ${err?.message}`);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  async detectFaces(imageBuffer: Buffer): Promise<RawFaceResult[]> {
    await this.ensureInitialized();
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new InternalServerErrorException('No image data provided');
    }

    const tmpPath = path.join(os.tmpdir(), `roc-face-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    fs.writeFileSync(tmpPath, imageBuffer);
    try {
      const image = await roc.roc_read_image(tmpPath, roc.ROC_BGR24);
      return await this.runFace(image);
    } catch (err) {
      this.logger.error('Face detection failed', err?.message);
      throw new InternalServerErrorException(`ROC Face error: ${err?.message}`);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  async representFaceRaw(imageBuffer: Buffer, originalFilename?: string): Promise<any[]> {
    await this.ensureInitialized();
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new InternalServerErrorException('No image data provided');
    }

    const ext = originalFilename ? path.extname(originalFilename).toLowerCase() || '.jpg' : '.jpg';
    const tmpPath = path.join(os.tmpdir(), `roc-enroll-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmpPath, imageBuffer);
    try {
      const image = await roc.roc_read_image(tmpPath, roc.ROC_BGR24);
      const adaptiveMinSize = roc.roc_adaptive_minimum_size(
        image.width, image.height,
        roc.ROC_SUGGESTED_RELATIVE_MIN_SIZE,
        roc.ROC_SUGGESTED_ABSOLUTE_MIN_SIZE,
      );
      return await roc.roc_represent_face(
        image,
        roc.ROC_FACE_DETECTION | roc.ROC_FACE_ACCURATE_REPRESENTATION | roc.ROC_FACE_THUMBNAIL,
        adaptiveMinSize,
        1,   // max faces
        1.0, // false detection rate
        0.0, // min quality — accept any detected face
      );
    } catch (err) {
      this.logger.error('Face representation failed', err?.message);
      throw new InternalServerErrorException(`ROC Face error: ${err?.message}`);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  async *detectVideoFrames(
    videoBuffer: Buffer,
    options: LprDetectOptions,
    frameStep = 15,
    originalFilename?: string,
  ): AsyncGenerator<CombinedResult> {
    const ext = originalFilename
      ? path.extname(originalFilename).toLowerCase() || '.mp4'
      : '.mp4';
    const tmpPath = path.join(os.tmpdir(), `roc-video-${Date.now()}${ext}`);
    fs.writeFileSync(tmpPath, videoBuffer);

    try {
      yield* this.processVideoSource(tmpPath, options, frameStep);
    } finally {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  async *detectStreamFrames(
    url: string,
    options: LprDetectOptions,
    frameStep = 5, // Lower frame step for live streams
  ): AsyncGenerator<CombinedResult> {
    yield* this.processVideoSource(url, options, frameStep);
  }

  private async *processVideoSource(
    source: string,
    options: LprDetectOptions,
    frameStep: number,
  ): AsyncGenerator<CombinedResult> {
    await this.ensureInitialized();
    try {
      // For network streams, ensure system_timestamps=true is set to avoid RTCP errors
      let finalSource = source;
      if (source.includes('://')) {
        const separator = source.includes('?') ? '&' : '?';
        if (!source.includes('system_timestamps')) {
          finalSource = `${source}${separator}system_timestamps=true`;
        }
      }

      const video = await roc.roc_open_video(finalSource, roc.ROC_BGR24);
      let frameIndex = 0;
      let skipped = 0;
      let processedCount = 0;

      while (true) {
        const frame = await roc.roc_read_frame(video);
        if (!frame) break;

        if (skipped < frameStep - 1) {
          skipped++;
          frameIndex++;
          continue;
        }
        skipped = 0;

        const start = Date.now();
        const [plates, faces] = await Promise.all([
          this.runLpr(frame, options),
          this.runFace(frame),
        ]);

        processedCount++;
        if (processedCount % 10 === 0) {
          this.logger.log(`Processing live feed: Frame #${frameIndex} (${plates.length} plates, ${faces.length} faces)`);
        }

        if (plates.length > 0 || faces.length > 0) {
          yield {
            frameIndex,
            plates,
            faces,
            processingTimeMs: Date.now() - start,
          };
        }
        frameIndex++;
      }
    } catch (err) {
      this.logger.error(`Error processing video source ${source}: ${err.message}`);
      throw err;
    }
  }

  ping(): boolean {
    return this.initialized;
  }

  private async runLpr(image: any, options: LprDetectOptions): Promise<RawPlateResult[]> {
    const algorithmId = this.buildAlgorithmId(options);
    const params = {
      algorithm_id: algorithmId,
      maximum_templates: options.maxPlates ?? 10,
      min_quality: options.minQuality ?? 0.2,
      relative_min_size: options.relativeMinSize ?? 0.03,
      degrees: options.degrees ?? 0,
      false_detection_rate: options.falseDetectionRate ?? 0.1,
      text_filter: options.textFilter ?? '',
      thumbnail: options.thumbnail ?? true,
      ignore_partial: options.ignorePartial ?? true,
    };

    const templates = await roc.roc_represent_lpr_ex(image, params);
    return templates.map((t: any) => this.parseTemplate(t, options));
  }

  private buildAlgorithmId(options: LprDetectOptions): number {
    let id = roc.ROC_LICENSE_PLATE_DETECTION | roc.ROC_LPR_TEXT_REPRESENTATION;

    switch (options.region) {
      case 'EUROPEAN': id |= roc.ROC_EUROPEAN_LICENSE_PLATE_CLASSIFICATION; break;
      case 'PACIFIC': id |= roc.ROC_PACIFIC_LICENSE_PLATE_CLASSIFICATION; break;
      default: id |= roc.ROC_NORTH_AMERICAN_LICENSE_PLATE_CLASSIFICATION;
    }

    if (options.thumbnail) id |= roc.ROC_LPR_THUMBNAIL;
    if (options.ignorePartial) id |= roc.ROC_LPR_IGNORE_PARTIAL;

    return id;
  }

  private parseTemplate(t: any, options: LprDetectOptions): RawPlateResult {
    const text = roc.roc_get_metadata(t, 'Text') ?? '';
    const state = roc.roc_get_metadata(t, 'LicensePlateState') ?? undefined;
    const region = roc.roc_get_metadata(t, 'Region') ?? undefined;
    const box = t.detection ?? {};

    const thumbnail = (options.thumbnail && t.tn?.length > 0)
      ? Buffer.from(t.tn).toString('base64')
      : undefined;

    return {
      text,
      confidence: box.confidence ?? 0,
      quality: box.confidence ?? 0,
      state,
      boundingBox: { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0, rotation: box.rotation ?? 0 },
      thumbnail,
      region,
    };
  }

  private async runFace(image: any): Promise<RawFaceResult[]> {
    const adaptive_min_size = roc.roc_adaptive_minimum_size(
      image.width,
      image.height,
      roc.ROC_SUGGESTED_RELATIVE_MIN_SIZE,
      roc.ROC_SUGGESTED_ABSOLUTE_MIN_SIZE,
    );

    const templates = await roc.roc_represent_face(
      image,
      roc.ROC_FACE_DETECTION | roc.ROC_FACE_ACCURATE_REPRESENTATION | roc.ROC_FACE_THUMBNAIL,
      adaptive_min_size,
      10, // Max faces
      roc.ROC_FACE_SUGGESTED_FALSE_DETECTION_RATE,
      roc.ROC_FACE_ACCURATE_SUGGESTED_MIN_QUALITY,
    );

    if (templates.length === 0) return [];

    // roc_search_persons returns a flat array of candidates per probe call.
    // Search each template individually so candidates map 1-to-1 with templates.
    return await Promise.all(templates.map(async (t: any) => {
      const candidates: any[] = await roc.roc_search_persons(
        this.gallery,
        [t],
        1,     // top-1 candidate
        0.0,   // min similarity
        true,  // one candidate per person
        false, // ignore identical
      );

      const best = candidates[0];
      const box = t.detection || {};

      if (best) {
        this.logger.debug(`Face match: ${roc.roc_uuid_to_string(best.person_id, false)} similarity=${best.similarity.toFixed(3)}`);
      } else {
        this.logger.debug('Face: no candidates in gallery');
      }

      return {
        confidence: box.confidence ?? 0,
        quality: box.confidence ?? 0,
        boundingBox: { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0, rotation: box.rotation ?? 0 },
        thumbnail: t.tn?.length > 0 ? Buffer.from(t.tn).toString('base64') : undefined,
        template: t.fv,
        personId: best?.similarity > 0.5 ? roc.roc_uuid_to_string(best.person_id, false) : undefined,
        similarity: best?.similarity,
      };
    }));
  }

  // Gallery methods for PersonsService

  // Used at enroll time: native template straight from roc_represent_face
  async enrollFaceNative(personId: string, nativeTemplate: any) {
    await this.ensureInitialized();
    nativeTemplate.person_id = `{${personId}}`;
    try {
      await roc.roc_enroll(this.gallery, nativeTemplate);
      this.logger.debug(`Enrolled face for person ${personId}`);
    } catch (err) {
      this.logger.error(`Failed to enroll person ${personId}: ${err.message}`);
      throw new InternalServerErrorException(`Face enrollment failed: ${err.message}`);
    }
  }

  // Used at startup gallery sync: re-enroll from stored serialized template
  async enrollFace(personId: string, storedBuffer: Buffer) {
    await this.ensureInitialized();
    this.logger.debug(`Re-enrolling person ${personId} (stored size: ${storedBuffer.length})`);
    try {
      const t = this.deserializeTemplate(storedBuffer);
      t.person_id = `{${personId}}`;
      await roc.roc_enroll(this.gallery, t);
      this.logger.debug(`Re-enrolled person ${personId}`);
    } catch (err) {
      this.logger.error(`Failed to re-enroll person ${personId}: ${err.message}`);
    }
  }

  serializeTemplate(nativeTemplate: any): Buffer {
    const obj: any = { ...nativeTemplate };
    if (obj.fv) obj.fv = Buffer.from(obj.fv).toString('base64');
    if (obj.tn) obj.tn = Buffer.from(obj.tn).toString('base64');
    if (typeof obj.timestamp === 'bigint') obj.timestamp = obj.timestamp.toString();
    return Buffer.from(JSON.stringify(obj));
  }

  deserializeTemplate(buf: Buffer): any {
    const obj = JSON.parse(buf.toString());
    if (obj.fv) obj.fv = Buffer.from(obj.fv, 'base64');
    if (obj.tn) obj.tn = Buffer.from(obj.tn, 'base64');
    if (obj.timestamp) obj.timestamp = BigInt(obj.timestamp);
    return obj;
  }

  async clearGallery() {
    await this.ensureInitialized();
    this.gallery = await roc.roc_open_gallery(null);
  }
}
