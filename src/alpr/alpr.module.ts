import { Module, forwardRef } from '@nestjs/common';
import { AlprController } from './alpr.controller';
import { AlprService } from './alpr.service';
import { RocModule } from '../roc/roc.module';
import { EventsModule } from '../events/events.module';
import { PersonsModule } from '../persons/persons.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FaceEventsModule } from '../face-events/face-events.module';

@Module({
  imports: [RocModule, EventsModule, PersonsModule, WatchlistModule, NotificationsModule, FaceEventsModule],
  controllers: [AlprController],
  providers: [AlprService],
  exports: [AlprService],
})
export class AlprModule {}
