import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FaceEvent } from './face-event.entity';
import { FaceEventsService } from './face-events.service';
import { FaceEventsController } from './face-events.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([FaceEvent]), NotificationsModule],
  controllers: [FaceEventsController],
  providers: [FaceEventsService],
  exports: [FaceEventsService],
})
export class FaceEventsModule {}
