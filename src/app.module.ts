import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { AlprModule } from './alpr/alpr.module';
import { EventsModule } from './events/events.module';
import { PersonsModule } from './persons/persons.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FaceEventsModule } from './face-events/face-events.module';
import { CamerasModule } from './cameras/cameras.module';
import { AuthModule } from './auth/auth.module';
import { RetentionModule } from './retention/retention.module';
import { JourneysModule } from './journeys/journeys.module';
import { DetectionEvent } from './events/detection-event.entity';
import { FaceEvent } from './face-events/face-event.entity';
import { Person } from './persons/person.entity';
import { WatchlistEntry } from './watchlist/watchlist.entity';
import { Alert } from './watchlist/alert.entity';
import { Camera } from './cameras/camera.entity';
import { Journey } from './journeys/journey.entity';
import { JourneySighting } from './journeys/journey-sighting.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: '.env' }),
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'data/alpr.sqlite',
      entities: [DetectionEvent, FaceEvent, Person, WatchlistEntry, Alert, Camera, Journey, JourneySighting],
      synchronize: true,
    }),
    AuthModule,
    NotificationsModule,
    EventsModule,
    PersonsModule,
    WatchlistModule,
    FaceEventsModule,
    AlprModule,
    CamerasModule,
    JourneysModule,
    RetentionModule,
  ],
})
export class AppModule {}
