import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Journey } from './journey.entity';
import { JourneySighting } from './journey-sighting.entity';
import { Camera } from '../cameras/camera.entity';
import { WatchlistService } from '../watchlist/watchlist.service';

const JOURNEY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface RecordSightingParams {
  plateText: string;
  cameraId: string;
  cameraName?: string;
  thumbnailBase64?: string;
  confidence: number;
  detectionEventId?: string;
}

@Injectable()
export class JourneysService {
  private readonly logger = new Logger(JourneysService.name);

  constructor(
    @InjectRepository(Journey)
    private readonly journeyRepo: Repository<Journey>,
    @InjectRepository(JourneySighting)
    private readonly sightingRepo: Repository<JourneySighting>,
    @InjectRepository(Camera)
    private readonly cameraRepo: Repository<Camera>,
    private readonly watchlist: WatchlistService,
  ) {}

  async recordSighting(params: RecordSightingParams): Promise<void> {
    const { plateText, cameraId, cameraName, thumbnailBase64, confidence, detectionEventId } = params;

    // Resolve camera location metadata
    const camera = await this.cameraRepo.findOne({ where: { id: cameraId } });
    const zone = camera?.zone;
    const lat = camera?.lat;
    const lng = camera?.lng;

    const windowCutoff = new Date(Date.now() - JOURNEY_WINDOW_MS);

    // Find the most recent active journey for this plate within the 24h window
    let journey = await this.journeyRepo.findOne({
      where: { plateText, status: 'active', lastSeenAt: MoreThan(windowCutoff) },
      order: { lastSeenAt: 'DESC' },
    });

    // Check if this is a cross-camera hop (different camera from last sighting)
    let isCrossCamera = false;
    if (journey) {
      const lastSighting = await this.sightingRepo.findOne({
        where: { journey: { id: journey.id } },
        order: { seenAt: 'DESC' },
      });
      if (lastSighting && lastSighting.cameraId !== cameraId) {
        isCrossCamera = true;
      }
    } else {
      journey = this.journeyRepo.create({
        plateText,
        status: 'active',
        startedAt: new Date(),
        lastSeenAt: new Date(),
      });
      await this.journeyRepo.save(journey);
    }

    const sighting = this.sightingRepo.create({
      journey: { id: journey.id } as any,
      cameraId,
      cameraName,
      zone,
      lat,
      lng,
      seenAt: new Date(),
      thumbnailBase64,
      confidence,
      detectionEventId,
    });
    await this.sightingRepo.save(sighting);

    // Targeted update — avoids loading/cascade-saving the full sightings array
    await this.journeyRepo.update(journey.id, { lastSeenAt: new Date() });

    if (isCrossCamera) {
      this.logger.log(
        `JOURNEY [${plateText}] crossed to camera "${cameraName ?? cameraId}"` +
        (zone ? ` — zone: ${zone}` : ''),
      );
      // Fire a watchlist alert if this plate is being tracked
      if (detectionEventId) {
        await this.watchlist.checkAndAlert(plateText, detectionEventId, thumbnailBase64);
      }
    }
  }

  async findAll(params: {
    plate?: string;
    status?: 'active' | 'closed';
    cameraId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Journey[]; total: number }> {
    const qb = this.journeyRepo.createQueryBuilder('j')
      .leftJoinAndSelect('j.sightings', 's')
      .orderBy('j.lastSeenAt', 'DESC');

    if (params.plate) qb.andWhere('j.plateText LIKE :plate', { plate: `%${params.plate.toUpperCase()}%` });
    if (params.status) qb.andWhere('j.status = :status', { status: params.status });
    if (params.startDate) qb.andWhere('j.startedAt >= :start', { start: new Date(params.startDate) });
    if (params.endDate) qb.andWhere('j.startedAt <= :end', { end: new Date(params.endDate) });
    if (params.cameraId) {
      qb.andWhere('s.cameraId = :cameraId', { cameraId: params.cameraId });
    }

    const total = await qb.getCount();
    const data = await qb.skip(params.offset ?? 0).take(params.limit ?? 25).getMany();
    return { data, total };
  }

  async findOne(id: string): Promise<Journey> {
    const journey = await this.journeyRepo.findOne({
      where: { id },
      relations: ['sightings'],
    });
    if (!journey) throw new NotFoundException(`Journey ${id} not found`);
    return journey;
  }

  /** Close journeys that have been idle past the 24h window (background cleanup). */
  async closeStale(): Promise<number> {
    const cutoff = new Date(Date.now() - JOURNEY_WINDOW_MS);
    const result = await this.journeyRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'closed' })
      .where('status = :status AND lastSeenAt < :cutoff', { status: 'active', cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
