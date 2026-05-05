import { Module } from '@nestjs/common';
import { AlprController } from './alpr.controller';
import { AlprService } from './alpr.service';
import { RocModule } from '../roc/roc.module';
import { EventsModule } from '../events/events.module';
import { PersonsModule } from '../persons/persons.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RocModule, EventsModule, PersonsModule, WatchlistModule, NotificationsModule],
  controllers: [AlprController],
  providers: [AlprService],
})
export class AlprModule {}
