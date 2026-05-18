import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DetectionEvent } from '../events/detection-event.entity';
import { FaceEvent } from '../face-events/face-event.entity';
import { Alert } from '../watchlist/alert.entity';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private intervalId: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DetectionEvent) private readonly eventsRepo: Repository<DetectionEvent>,
    @InjectRepository(FaceEvent)      private readonly faceRepo: Repository<FaceEvent>,
    @InjectRepository(Alert)          private readonly alertsRepo: Repository<Alert>,
  ) {}

  onModuleInit() {
    const days = this.config.get<number>('retention.days') ?? 90;
    if (days === 0) {
      this.logger.log('Retention disabled (RETENTION_DAYS=0)');
      return;
    }
    // Run once shortly after startup, then every 24h
    setTimeout(() => this.purge(), 30_000);
    this.intervalId = setInterval(() => this.purge(), ONE_DAY_MS);
    this.logger.log(`Retention policy: ${days} days`);
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async purge() {
    const days = this.config.get<number>('retention.days') ?? 90;
    if (days === 0) return;

    const cutoff = new Date(Date.now() - days * ONE_DAY_MS);
    this.logger.log(`Purging records older than ${cutoff.toISOString()}`);

    try {
      const [evts, faces, alerts] = await Promise.all([
        this.eventsRepo.createQueryBuilder().delete().where('timestamp < :cutoff', { cutoff }).execute(),
        this.faceRepo.createQueryBuilder().delete().where('timestamp < :cutoff', { cutoff }).execute(),
        this.alertsRepo.createQueryBuilder().delete().where('timestamp < :cutoff', { cutoff }).execute(),
      ]);
      this.logger.log(
        `Purge complete: ${evts.affected} events, ${faces.affected} face events, ${alerts.affected} alerts removed`,
      );
    } catch (err) {
      this.logger.error(`Purge failed: ${err.message}`);
    }
  }
}
