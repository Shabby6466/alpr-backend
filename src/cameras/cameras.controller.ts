import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CamerasService } from './cameras.service';
import { CameraWorkerService } from './camera-worker.service';
import { CreateCameraDto, UpdateCameraDto } from './dto/camera.dto';

@ApiTags('Cameras')
@Controller('cameras')
export class CamerasController {
  constructor(
    private readonly cameras: CamerasService,
    private readonly workers: CameraWorkerService,
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

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a camera and stop its worker' })
  async remove(@Param('id') id: string) {
    this.workers.stopWorker(id);
    await this.cameras.remove(id);
    return { success: true };
  }
}
