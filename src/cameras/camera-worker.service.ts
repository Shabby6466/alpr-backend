import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Camera } from './camera.entity';
import { CamerasService } from './cameras.service';
import { AlprService } from '../alpr/alpr.service';

const RECONNECT_DELAY_MS = 5_000;

@Injectable()
export class CameraWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CameraWorkerService.name);
  private readonly running = new Map<string, boolean>();

  constructor(
    private readonly cameras: CamerasService,
    private readonly alpr: AlprService,
  ) {}

  async onModuleInit() {
    // Delay startup to let AlprService / RocService finish initialization
    setTimeout(() => this.startAllActive(), 3_000);
  }

  onModuleDestroy() {
    for (const id of this.running.keys()) this.stopWorker(id);
  }

  private async startAllActive() {
    const activeCameras = await this.cameras.findActive();
    this.logger.log(`Starting workers for ${activeCameras.length} active camera(s)`);
    for (const camera of activeCameras) {
      this.startWorker(camera);
    }
  }

  startWorker(camera: Camera) {
    if (this.running.has(camera.id)) return;
    this.running.set(camera.id, true);
    this.runLoop(camera).catch(err => {
      this.logger.error(`Worker for camera "${camera.name}" crashed: ${err.message}`);
      this.running.delete(camera.id);
    });
  }

  stopWorker(id: string) {
    this.running.set(id, false); // signal the loop to exit
    this.running.delete(id);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  private async runLoop(camera: Camera) {
    this.logger.log(`Worker started for camera "${camera.name}" (${camera.url})`);

    const params = {
      region: camera.region,
      frameStep: camera.frameStep,
      thumbnail: true,
      ignorePartial: true,
      roiInclude: camera.roiInclude,
      roiExclude: camera.roiExclude,
    };

    // Use on-disk test video when assigned; fall back to the configured stream URL
    const source = camera.testVideoPath ?? camera.url;
    const isTestVideo = !!camera.testVideoPath;

    if (isTestVideo) {
      // Loop the file as one continuous tracking session — restart on unexpected errors
      while (this.running.has(camera.id)) {
        try {
          for await (const _ of this.alpr.detectLoopingFile(
            source, params as any, camera.id, camera.name,
            () => this.running.has(camera.id),
          )) {
            // results are side-effected into DB/SSE inside detectLoopingFile
          }
        } catch (err: any) {
          if (!this.running.has(camera.id)) break;
          this.logger.warn(`Camera "${camera.name}" test-video error: ${err.message} — restarting in 2s`);
          await this.sleep(2_000);
          continue;
        }
        // detectLoopingFile exited cleanly (shouldContinue returned false)
        break;
      }
    } else {
      // Live RTSP stream: reconnect loop
      while (this.running.has(camera.id)) {
        try {
          for await (const _ of this.alpr.detectLiveStream(source, params as any, camera.id, camera.name)) {
            if (!this.running.has(camera.id)) break;
          }
        } catch (err: any) {
          if (!this.running.has(camera.id)) break;
          this.logger.warn(`Camera "${camera.name}" stream error: ${err.message} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
          await this.sleep(RECONNECT_DELAY_MS);
          continue;
        }
        if (!this.running.has(camera.id)) break;
        this.logger.log(`Camera "${camera.name}" stream ended — reconnecting...`);
        await this.sleep(1_000);
      }
    }

    this.logger.log(`Worker stopped for camera "${camera.name}"`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
