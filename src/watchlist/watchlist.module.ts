import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistEntry } from './watchlist.entity';
import { Alert } from './alert.entity';
import { WatchlistService } from './watchlist.service';
import { WatchlistController, AlertsController } from './watchlist.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PersonsModule } from '../persons/persons.module';

@Module({
  imports: [TypeOrmModule.forFeature([WatchlistEntry, Alert]), NotificationsModule, PersonsModule],
  providers: [WatchlistService],
  controllers: [WatchlistController, AlertsController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
