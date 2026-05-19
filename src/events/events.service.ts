import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DetectionEvent } from './detection-event.entity';
import { normalizePlate } from '../common/plate.util';

export interface CreateEventDto {
  plateText: string;
  confidence: number;
  source: 'image' | 'video' | 'stream' | 'camera';
  personId?: string;
  personName?: string;
  thumbnailBase64?: string;
  x: number; y: number; width: number; height: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleThumbnail?: string;
  direction?: 'left' | 'right' | 'stationary';
  cameraId?: string;
  cameraName?: string;
  gunDetected?: boolean;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(DetectionEvent)
    private readonly repo: Repository<DetectionEvent>,
  ) {}

  create(dto: CreateEventDto): Promise<DetectionEvent> {
    const event = this.repo.create({ gunDetected: false, ...dto });
    return this.repo.save(event);
  }

  findAll(filters: {
    plate?: string;
    personId?: string;
    source?: string;
    startDate?: string;
    endDate?: string;
    cameraId?: string;
    limit?: number;
    offset?: number;
  }): Promise<[DetectionEvent[], number]> {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.timestamp', 'DESC');

    if (filters.plate) qb.andWhere('e.plateText LIKE :plate', { plate: `%${normalizePlate(filters.plate)}%` });
    if (filters.personId) qb.andWhere('e.personId = :personId', { personId: filters.personId });
    if (filters.source) qb.andWhere('e.source = :source', { source: filters.source });
    if (filters.cameraId) qb.andWhere('e.cameraId = :cameraId', { cameraId: filters.cameraId });
    if (filters.startDate) qb.andWhere('e.timestamp >= :start', { start: new Date(filters.startDate) });
    if (filters.endDate) qb.andWhere('e.timestamp <= :end', { end: new Date(filters.endDate) });

    qb.take(filters.limit ?? 50).skip(filters.offset ?? 0);
    return qb.getManyAndCount();
  }

  findByPerson(personId: string, limit = 100, offset = 0): Promise<DetectionEvent[]> {
    return this.repo.find({
      where: { personId },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async getStats(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    // Group by hour for single day, by day for multi-day ranges
    const bucketExpr = days <= 1
      ? "strftime('%Y-%m-%d %H:00:00', e.timestamp)"
      : "strftime('%Y-%m-%d', e.timestamp)";
    const raw = await this.repo.createQueryBuilder('e')
      .select(bucketExpr, 'bucket')
      .addSelect('COUNT(*)', 'count')
      .where('e.timestamp >= :start', { start: startDate })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany();
    return raw.map(r => ({ time: r.bucket, count: parseInt(r.count, 10) }));
  }

  async getSummary(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    const [total, uniquePlatesRaw, avgConfRaw] = await Promise.all([
      this.repo.createQueryBuilder('e')
        .where('e.timestamp >= :start', { start: startDate })
        .getCount(),
      this.repo.createQueryBuilder('e')
        .select('COUNT(DISTINCT e.plateText)', 'n')
        .where('e.timestamp >= :start', { start: startDate })
        .getRawOne(),
      this.repo.createQueryBuilder('e')
        .select('AVG(e.confidence)', 'avg')
        .where('e.timestamp >= :start', { start: startDate })
        .getRawOne(),
    ]);
    return {
      total,
      uniquePlates: parseInt(uniquePlatesRaw?.n ?? '0', 10),
      avgConfidence: parseFloat(avgConfRaw?.avg ?? '0'),
    };
  }

  async getTopPlates(limit = 10, days?: number) {
    const qb = this.repo.createQueryBuilder('e')
      .select('e.plateText', 'plate')
      .addSelect('COUNT(*)', 'count')
      .groupBy('e.plateText')
      .orderBy('count', 'DESC')
      .limit(limit);
    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);
      qb.where('e.timestamp >= :start', { start: startDate });
    }
    return qb.getRawMany();
  }

  async getTopCameras(limit = 10, days?: number) {
    const qb = this.repo.createQueryBuilder('e')
      .select('COALESCE(e.cameraName, e.cameraId)', 'camera')
      .addSelect('COUNT(*)', 'count')
      .where('e.cameraId IS NOT NULL')
      .groupBy('camera')
      .orderBy('count', 'DESC')
      .limit(limit);
    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);
      qb.andWhere('e.timestamp >= :start', { start: startDate });
    }
    return qb.getRawMany();
  }

  async getTopPersons(limit = 10) {
    return this.repo.createQueryBuilder('e')
      .select('e.personName', 'name')
      .addSelect('e.personId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('e.personId IS NOT NULL')
      .groupBy('e.personId')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();
  }

  async getVehicleStats(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const makes = await this.repo.createQueryBuilder('e')
      .select('e.vehicleMake', 'make')
      .addSelect('COUNT(*)', 'count')
      .where('e.timestamp >= :start AND e.vehicleMake IS NOT NULL', { start: startDate })
      .groupBy('e.vehicleMake')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();
    const colors = await this.repo.createQueryBuilder('e')
      .select('e.vehicleColor', 'color')
      .addSelect('COUNT(*)', 'count')
      .where('e.timestamp >= :start AND e.vehicleColor IS NOT NULL', { start: startDate })
      .groupBy('e.vehicleColor')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();
    return { makes, colors };
  }

  async getSourceBreakdown(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    return this.repo.createQueryBuilder('e')
      .select('e.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .where('e.timestamp >= :start', { start: startDate })
      .groupBy('e.source')
      .getRawMany();
  }

  delete(id: string) {
    return this.repo.delete(id);
  }

  deleteOlderThan(cutoff: Date) {
    return this.repo.createQueryBuilder()
      .delete()
      .where('timestamp < :cutoff', { cutoff })
      .execute();
  }
}
