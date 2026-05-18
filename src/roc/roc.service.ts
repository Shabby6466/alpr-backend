import { Injectable, Logger, OnModuleDestroy, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const roc = require(path.resolve(process.cwd(), 'roc.node'));

export interface RoiZone { x: number; y: number; width: number; height: number; }

export interface LprDetectOptions {
  image?: Buffer;
  maxPlates?: number;
  minQuality?: number;
  relativeMinSize?: number;
  region?: string; // NORTH_AMERICAN | EUROPEAN | PACIFIC | ASIAN | MIDDLE_EASTERN
  thumbnail?: boolean;
  ignorePartial?: boolean;
  degrees?: number;
  falseDetectionRate?: number;
  textFilter?: string;
  roiInclude?: RoiZone[];
  roiExclude?: RoiZone[];
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
  spoofScore?: number;
  spoofDetected?: boolean;
  occluded?: boolean;
  boundingBox: { x: number; y: number; width: number; height: number; rotation: number };
  thumbnail?: string;
  template: Buffer;
  personId?: string;
  similarity?: number;
}

export interface RawVehicleResult {
  make?: string;
  model?: string;
  color?: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number; rotation: number };
  thumbnail?: string;
}

export interface CombinedResult {
  frameIndex: number;
  plates: RawPlateResult[];
  faces: RawFaceResult[];
  vehicles: RawVehicleResult[];
  hasVehicle: boolean;
  hasGun: boolean;
  processingTimeMs: number;
}

@Injectable()
export class RocService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RocService.name);
  private initialized = false;
  private gallery: any;
  private initPromise: Promise<void> | null = null;
  private readonly galleryPath: string;

  // Cached license capability flags — set to false on first "does not support" error
  private vehicleDetectionSupported = true;
  private gunDetectionSupported = true;

  constructor(private readonly config: ConfigService) {
    this.galleryPath = path.resolve(process.cwd(), 'data/gallery.roc');
  }

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
        this.gallery = await this.openGallery();
        this.initialized = true;
        this.logger.log(`ROC SDK initialized, model path: ${modelPath}`);
        await this.probeCapabilities();
      } catch (err) {
        this.initPromise = null;
        this.logger.error(`ROC SDK initialization failed: ${err.message}`);
        throw err;
      }
    })();

    return this.initPromise;
  }

  private async openGallery(fresh = false): Promise<any> {
    try {
      if (fresh && fs.existsSync(this.galleryPath)) {
        fs.unlinkSync(this.galleryPath);
      }
      fs.mkdirSync(path.dirname(this.galleryPath), { recursive: true });
      const gallery = await roc.roc_open_gallery(this.galleryPath);
      this.logger.log(`Opened persistent gallery at ${this.galleryPath}`);
      return gallery;
    } catch (err) {
      this.logger.warn(`Persistent gallery unavailable (${err.message}), using RAM gallery`);
      return roc.roc_open_gallery(null);
    }
  }

  onModuleDestroy() {
    if (this.initialized) {
      roc.roc_finalize();
      this.logger.log('ROC SDK finalized');
    }
  }

  /** Probe what the license supports at startup and cache the results. */
  private async probeCapabilities() {
    const tmpPath = path.join(os.tmpdir(), `roc-probe-${Date.now()}.jpg`);
    // 1×1 white JPEG (minimal valid image for SDK probing)
    const onePixel = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
      'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
      'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
      'MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIhAA' +
      'AgIBBAMAAAAAAAAAAAAAAQIDBAUSITFBUf/EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEB' +
      'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqU6hVa7cNZNkMSyyDPqRRjGMepjGMep' +
      'j/9k=',
      'base64',
    );
    fs.writeFileSync(tmpPath, onePixel);
    try {
      const image = await roc.roc_read_image(tmpPath, roc.ROC_BGR24);
      // Probe vehicle
      try {
        await roc.roc_represent_object_ex(image, {
          algorithm_id: roc.ROC_VEHICLE_DETECTION | roc.ROC_OBJECT_FAST_DETECTION,
          maximum_templates: 1, min_quality: 0.0, relative_min_size: 0.05,
          false_detection_rate: 1.0, thumbnail: false, ignore_partial: false,
        });
      } catch (err) {
        if (err.message?.includes('does not support')) {
          this.vehicleDetectionSupported = false;
        }
      }
      // Probe gun
      try {
        await roc.roc_represent_object_ex(image, {
          algorithm_id: roc.ROC_GUN_DETECTION | roc.ROC_OBJECT_FAST_DETECTION,
          maximum_templates: 1, min_quality: 0.0, relative_min_size: 0.02,
          false_detection_rate: 1.0, thumbnail: false, ignore_partial: false,
        });
      } catch (err) {
        if (err.message?.includes('does not support')) {
          this.gunDetectionSupported = false;
        }
      }
    } catch {
      // probe image unreadable — capabilities unknown, leave flags at true (will fail gracefully on first real call)
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
    this.logger.log(
      `License capabilities — vehicle: ${this.vehicleDetectionSupported}, gun: ${this.gunDetectionSupported}, face: true, lpr: true`,
    );
  }

  capabilities() {
    return {
      lpr: true,
      face: true,
      vehicle: this.vehicleDetectionSupported,
      gun: this.gunDetectionSupported,
    };
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
        1,
        1.0,
        0.0,
      );
    } catch (err) {
      this.logger.error('Face representation failed', err?.message);
      throw new InternalServerErrorException(`ROC Face error: ${err?.message}`);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  /**
   * Fast vehicle presence check. Returns true if at least one vehicle is detected.
   * Used for vehicle-first gating before running full LPR+face.
   * Guards roc_represent_object_ex with a try/catch — if the addon segfaults the
   * process will restart; tune ENABLE_OBJECT_DETECTION=false to disable.
   */
  async hasVehicle(image: any): Promise<boolean> {
    if (!this.config.get<boolean>('features.objectDetection')) return true;
    if (!this.vehicleDetectionSupported) return true;
    try {
      const params = {
        algorithm_id: roc.ROC_VEHICLE_DETECTION | roc.ROC_OBJECT_FAST_DETECTION,
        maximum_templates: 1,
        min_quality: 0.3,
        relative_min_size: 0.05,
        false_detection_rate: 1.0,
        thumbnail: false,
        ignore_partial: false,
      };
      const objects = await roc.roc_represent_object_ex(image, params);
      return objects.length > 0;
    } catch (err) {
      if (err.message?.includes('does not support')) {
        this.vehicleDetectionSupported = false;
        this.logger.warn(`Vehicle detection not licensed — disabling for this session`);
      } else {
        this.logger.warn(`Object detection (fast) failed: ${err.message} — bypassing gate`);
      }
      return true;
    }
  }

  /**
   * Full vehicle detection with make/model/color metadata.
   */
  async detectVehicles(image: any): Promise<RawVehicleResult[]> {
    if (!this.config.get<boolean>('features.objectDetection')) return [];
    if (!this.vehicleDetectionSupported) return [];
    try {
      const params = {
        algorithm_id: roc.ROC_VEHICLE_DETECTION | roc.ROC_MAKE_MODEL_COLOR_CLASSIFICATION | roc.ROC_COLOR_REPRESENTATION | roc.ROC_OBJECT_THUMBNAIL,
        maximum_templates: 10,
        min_quality: 0.3,
        relative_min_size: 0.05,
        false_detection_rate: 1.0,
        thumbnail: true,
        ignore_partial: false,
      };
      const templates = await roc.roc_represent_object_ex(image, params);
      return templates.map((t: any) => this.parseVehicleTemplate(t));
    } catch (err) {
      if (err.message?.includes('does not support')) {
        this.vehicleDetectionSupported = false;
        this.logger.warn(`Vehicle detection not licensed — disabling for this session`);
      } else {
        this.logger.warn(`Vehicle detection failed: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Gun/weapon detection in the frame.
   */
  async detectGuns(image: any): Promise<boolean> {
    if (!this.config.get<boolean>('features.gunDetection')) return false;
    if (!this.gunDetectionSupported) return false;
    try {
      const params = {
        algorithm_id: roc.ROC_GUN_DETECTION | roc.ROC_OBJECT_FAST_DETECTION,
        maximum_templates: 3,
        min_quality: 0.3,
        relative_min_size: 0.02,
        false_detection_rate: 1.0,
        thumbnail: false,
        ignore_partial: false,
      };
      const objects = await roc.roc_represent_object_ex(image, params);
      return objects.length > 0;
    } catch (err) {
      if (err.message?.includes('does not support')) {
        this.gunDetectionSupported = false;
        this.logger.warn(`Gun detection not licensed — disabling for this session`);
      } else {
        this.logger.warn(`Gun detection failed: ${err.message}`);
      }
      return false;
    }
  }

  async *detectVideoFrames(
    videoBuffer: Buffer,
    options: LprDetectOptions,
    frameStep = 5,
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
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  async *detectStreamFrames(
    url: string,
    options: LprDetectOptions,
    frameStep = 5,
  ): AsyncGenerator<CombinedResult> {
    yield* this.processVideoSource(url, options, frameStep);
  }

  private async *processVideoSource(
    source: string,
    options: LprDetectOptions,
    baseFrameStep: number,
  ): AsyncGenerator<CombinedResult> {
    await this.ensureInitialized();
    try {
      let finalSource = source;
      if (source.includes('://') && !source.includes('system_timestamps')) {
        const sep = source.includes('?') ? '&' : '?';
        finalSource = `${source}${sep}system_timestamps=true`;
      }

      const video = await roc.roc_open_video(finalSource, roc.ROC_BGR24);
      let frameIndex = 0;
      let skipped = 0;
      let processedCount = 0;
      // Adaptive frameStep: tighten when a vehicle was detected in the last processed frame
      let adaptiveStep = baseFrameStep;

      while (true) {
        const frame = await roc.roc_read_frame(video);
        if (!frame || !frame.data) break;

        if (skipped < adaptiveStep - 1) {
          skipped++;
          frameIndex++;
          continue;
        }
        skipped = 0;

        const start = Date.now();

        // Vehicle-first gate: only LPR/object detection needs vehicles
        const vehiclePresent = await this.hasVehicle(frame);
        adaptiveStep = vehiclePresent ? Math.max(2, Math.floor(baseFrameStep / 3)) : baseFrameStep;

        let plates: RawPlateResult[] = [];
        let vehicles: RawVehicleResult[] = [];
        let hasGun = false;

        if (vehiclePresent) {
          [plates, vehicles, hasGun] = await Promise.all([
            this.runLpr(frame, options),
            this.detectVehicles(frame),
            this.detectGuns(frame),
          ]);
        }

        // Face detection always runs — persons on bikes/walking are not vehicles
        const faces = await this.runFace(frame);

        processedCount++;
        if (processedCount % 20 === 0) {
          this.logger.log(`Frame #${frameIndex}: ${plates.length} plates, ${faces.length} faces, vehicle=${vehiclePresent}`);
        }

        if (plates.length > 0 || faces.length > 0 || vehicles.length > 0 || hasGun) {
          yield {
            frameIndex,
            plates,
            faces,
            vehicles,
            hasVehicle: vehiclePresent,
            hasGun,
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
    const algorithmId = this.buildLprAlgorithmId(options);
    const params: Record<string, any> = {
      algorithm_id: algorithmId,
      maximum_templates: options.maxPlates ?? 10,
      min_quality: options.minQuality ?? 0.2,
      relative_min_size: options.relativeMinSize ?? 0.02,
      degrees: options.degrees ?? 0,
      false_detection_rate: options.falseDetectionRate ?? 0.1,
      text_filter: options.textFilter ?? '',
      thumbnail: options.thumbnail ?? true,
      ignore_partial: options.ignorePartial ?? true,
    };

    if (options.roiInclude?.length) {
      params.roi_params = {
        include: options.roiInclude,
        exclude: options.roiExclude ?? [],
        min_overlap: 0.5,
      };
    }

    const templates = await roc.roc_represent_lpr_ex(image, params);
    return templates.map((t: any) => this.parseTemplate(t, options));
  }

  private buildLprAlgorithmId(options: LprDetectOptions): number {
    let id = roc.ROC_LICENSE_PLATE_DETECTION | roc.ROC_LPR_TEXT_REPRESENTATION;

    switch (options.region) {
      case 'EUROPEAN': id |= roc.ROC_EUROPEAN_LICENSE_PLATE_CLASSIFICATION; break;
      case 'PACIFIC': id |= roc.ROC_PACIFIC_LICENSE_PLATE_CLASSIFICATION; break;
      case 'ASIAN': id |= roc.ROC_ASIAN_LICENSE_PLATE_CLASSIFICATION; break;
      case 'MIDDLE_EASTERN': id |= roc.ROC_MIDDLE_EASTERN_LICENSE_PLATE_CLASSIFICATION; break;
      case 'AFRICAN': id |= roc.ROC_AFRICAN_LICENSE_PLATE_CLASSIFICATION; break;
      case 'SOUTH_AMERICAN': id |= roc.ROC_SOUTH_AMERICAN_LICENSE_PLATE_CLASSIFICATION; break;
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
      quality: t.quality ?? box.confidence ?? 0,
      state,
      boundingBox: { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0, rotation: box.rotation ?? 0 },
      thumbnail,
      region,
    };
  }

  private parseVehicleTemplate(t: any): RawVehicleResult {
    const box = t.detection ?? {};
    return {
      make: roc.roc_get_metadata(t, 'Make') ?? roc.roc_get_metadata(t, 'VehicleMake') ?? undefined,
      model: roc.roc_get_metadata(t, 'Model') ?? roc.roc_get_metadata(t, 'VehicleModel') ?? undefined,
      color: roc.roc_get_metadata(t, 'Color') ?? roc.roc_get_metadata(t, 'VehicleColor') ?? undefined,
      confidence: box.confidence ?? 0,
      boundingBox: { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0, rotation: box.rotation ?? 0 },
      thumbnail: t.tn?.length > 0 ? Buffer.from(t.tn).toString('base64') : undefined,
    };
  }

  private async runFace(image: any): Promise<RawFaceResult[]> {
    const adaptive_min_size = roc.roc_adaptive_minimum_size(
      image.width, image.height,
      roc.ROC_SUGGESTED_RELATIVE_MIN_SIZE,
      roc.ROC_SUGGESTED_ABSOLUTE_MIN_SIZE,
    );

    // ROC_SPOOF: attaches a spoof likelihood score to each template's metadata
    const algorithmId = roc.ROC_FACE_DETECTION | roc.ROC_FACE_ACCURATE_REPRESENTATION | roc.ROC_FACE_THUMBNAIL | roc.ROC_SPOOF;

    const templates = await roc.roc_represent_face(
      image,
      algorithmId,
      adaptive_min_size,
      10,
      roc.ROC_FACE_SUGGESTED_FALSE_DETECTION_RATE,
      0.05, // lowered from ROC_FACE_ACCURATE_SUGGESTED_MIN_QUALITY — catches distant/blurry faces in surveillance
    );

    if (templates.length === 0) return [];

    return await Promise.all(templates.map(async (t: any) => {
      const candidates: any[] = await roc.roc_search_persons(
        this.gallery,
        [t],
        1,
        0.0,
        true,
        false,
      );

      const best = candidates[0];
      const box = t.detection || {};

      // Extract spoof score from template metadata; convention may vary by SDK version
      const spoofRaw = roc.roc_get_metadata(t, 'SpoofScore') ?? roc.roc_get_metadata(t, 'Spoof');
      const spoofScore = spoofRaw != null ? parseFloat(spoofRaw) : undefined;
      const SPOOF_THRESHOLD = 0.5;
      const spoofDetected = spoofScore != null ? spoofScore > SPOOF_THRESHOLD : undefined;
      // Helmet/occlusion heuristic: face quality below 0.05 after detection
      const occluded = (t.quality ?? 0) < 0.05;

      return {
        confidence: box.confidence ?? 0,
        quality: t.quality ?? box.confidence ?? 0,
        spoofScore,
        spoofDetected,
        occluded,
        boundingBox: { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0, rotation: box.rotation ?? 0 },
        thumbnail: t.tn?.length > 0 ? Buffer.from(t.tn).toString('base64') : undefined,
        template: t.template || t.fv,
        // Don't match if spoof detected — prevent photo-in-front-of-camera attacks
        personId: (!spoofDetected && best?.similarity > 0.5)
          ? roc.roc_uuid_to_string(best.person_id, false)
          : undefined,
        similarity: best?.similarity,
      };
    }));
  }

  // Gallery management

  async enrollFaceNative(personId: string, nativeTemplate: any) {
    if (!nativeTemplate) return;
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

  async enrollFace(personId: string, storedBuffer: Buffer) {
    if (!storedBuffer) return;
    await this.ensureInitialized();
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
    this.gallery = await this.openGallery(true);
  }

  /**
   * Process a Buffer for vehicle + gun detection in a single temp-file read.
   * Used by detectFromFile/detectFromUrl — avoids the null-image placeholder.
   */
  async detectObjectsFromBuffer(imageBuffer: Buffer): Promise<{ vehicles: RawVehicleResult[]; hasGun: boolean }> {
    const objEnabled = this.config.get<boolean>('features.objectDetection');
    const gunEnabled = this.config.get<boolean>('features.gunDetection');
    if ((!objEnabled && !gunEnabled) || !imageBuffer?.length) {
      return { vehicles: [], hasGun: false };
    }

    const tmpPath = path.join(os.tmpdir(), `roc-obj-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    fs.writeFileSync(tmpPath, imageBuffer);
    try {
      const image = await roc.roc_read_image(tmpPath, roc.ROC_BGR24);
      const [vehicles, hasGun] = await Promise.all([
        this.detectVehicles(image),
        this.detectGuns(image),
      ]);
      return { vehicles, hasGun };
    } catch (err) {
      this.logger.warn(`Object detection from buffer failed: ${err.message}`);
      return { vehicles: [], hasGun: false };
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  // Expose the raw image reader so CameraWorkerService can process frames
  async readImage(filePath: string): Promise<any> {
    return roc.roc_read_image(filePath, roc.ROC_BGR24);
  }
}
