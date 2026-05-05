import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { AlprModule } from './alpr/alpr.module';
import { EventsModule } from './events/events.module';
import { PersonsModule } from './persons/persons.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DetectionEvent } from './events/detection-event.entity';
import { Person } from './persons/person.entity';
import { WatchlistEntry } from './watchlist/watchlist.entity';
import { Alert } from './watchlist/alert.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: '.env' }),
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'data/alpr.sqlite',
      entities: [DetectionEvent, Person, WatchlistEntry, Alert],
      synchronize: true,
    }),
    NotificationsModule,
    EventsModule,
    PersonsModule,
    WatchlistModule,
    AlprModule,
  ],
})
export class AppModule {}
