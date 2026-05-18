import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Camera } from './camera.entity';
import { CamerasService } from './cameras.service';
import { CamerasController } from './cameras.controller';
import { CameraWorkerService } from './camera-worker.service';
import { AlprModule } from '../alpr/alpr.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Camera]),
    forwardRef(() => AlprModule),
  ],
  providers: [CamerasService, CameraWorkerService],
  controllers: [CamerasController],
  exports: [CamerasService, CameraWorkerService],
})
export class CamerasModule {}
