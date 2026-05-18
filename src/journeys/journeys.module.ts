import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Journey } from './journey.entity';
import { JourneySighting } from './journey-sighting.entity';
import { Camera } from '../cameras/camera.entity';
import { JourneysService } from './journeys.service';
import { JourneysController } from './journeys.controller';
import { WatchlistModule } from '../watchlist/watchlist.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Journey, JourneySighting, Camera]),
    WatchlistModule,
  ],
  providers: [JourneysService],
  controllers: [JourneysController],
  exports: [JourneysService],
})
export class JourneysModule {}
