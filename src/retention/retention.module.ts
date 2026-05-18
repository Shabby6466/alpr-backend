import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RetentionService } from './retention.service';
import { DetectionEvent } from '../events/detection-event.entity';
import { FaceEvent } from '../face-events/face-event.entity';
import { Alert } from '../watchlist/alert.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DetectionEvent, FaceEvent, Alert])],
  providers: [RetentionService],
})
export class RetentionModule {}
