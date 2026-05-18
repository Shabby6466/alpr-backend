import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FaceEvent } from './face-event.entity';
import { FaceEventsService } from './face-events.service';
import { FaceEventsController } from './face-events.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FaceEvent])],
  controllers: [FaceEventsController],
  providers: [FaceEventsService],
  exports: [FaceEventsService],
})
export class FaceEventsModule {}
