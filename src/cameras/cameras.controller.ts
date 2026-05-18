import { Controller, Get, Post, Patch, Delete, Body, Param, UseInterceptors, UploadedFile, Res, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { CamerasService } from './cameras.service';
import { CameraWorkerService } from './camera-worker.service';
import { AlprService } from '../alpr/alpr.service';
import { CreateCameraDto, UpdateCameraDto } from './dto/camera.dto';

@ApiTags('Cameras')
@Controller('cameras')
export class CamerasController {
  private readonly logger = new Logger(CamerasController.name);
  constructor(
    private readonly cameras: CamerasService,
    private readonly workers: CameraWorkerService,
    private readonly alpr: AlprService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a new camera stream' })
  async create(@Body() dto: CreateCameraDto) {
    const camera = await this.cameras.create(dto);
    if (camera.active) this.workers.startWorker(camera);
    return camera;
  }

  @Get()
  @ApiOperation({ summary: 'List all cameras with worker status' })
  async findAll() {
    const cameras = await this.cameras.findAll();
    return cameras.map(c => ({ ...c, streaming: this.workers.isRunning(c.id) }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a camera by ID' })
  async findOne(@Param('id') id: string) {
    const camera = await this.cameras.findOne(id);
    return { ...camera, streaming: this.workers.isRunning(id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update camera settings (active=false stops the worker)' })
  async update(@Param('id') id: string, @Body() dto: UpdateCameraDto) {
    const camera = await this.cameras.update(id, dto);
    if (dto.active === false) {
      this.workers.stopWorker(id);
    } else if (dto.active === true && !this.workers.isRunning(id)) {
      this.workers.startWorker(camera);
    } else if (dto.url !== undefined || dto.region !== undefined || dto.frameStep !== undefined) {
      // Restart worker if stream params changed
      this.workers.stopWorker(id);
      if (camera.active) this.workers.startWorker(camera);
    }
    return { ...camera, streaming: this.workers.isRunning(id) };
  }

  @Post(':id/test-video')
  @ApiOperation({ summary: 'Upload a test video processed as if seen by this camera — creates journey sightings with camera GPS' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('video', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  async testVideo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    const camera = await this.cameras.findOne(id);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    this.logger.log(`Test video for camera "${camera.name}": ${file?.originalname} (${((file?.size ?? 0) / 1024 / 1024).toFixed(2)} MB)`);
    let frames = 0;
    try {
      for await (const frame of this.alpr.testCameraWithVideo(camera, file)) {
        frames++;
        res.write(`event: detection\ndata: ${JSON.stringify(frame)}\n\n`);
      }
    } catch (err: any) {
      this.logger.error(`Test video error after ${frames} frames: ${err?.message}`);
      res.write(`event: error\ndata: ${JSON.stringify({ error: err?.message })}\n\n`);
    } finally {
      this.logger.log(`Test video done for "${camera.name}": ${frames} frames`);
      res.write(`event: done\ndata: ${JSON.stringify({ frames })}\n\n`);
      res.end();
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a camera and stop its worker' })
  async remove(@Param('id') id: string) {
    this.workers.stopWorker(id);
    await this.cameras.remove(id);
    return { success: true };
  }
}
