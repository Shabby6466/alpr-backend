import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like } from 'typeorm';
import { DetectionEvent } from './detection-event.entity';
import { normalizePlate } from '../common/plate.util';

export interface CreateEventDto {
  plateText: string;
  confidence: number;
  source: 'image' | 'video' | 'stream';
  personId?: string;
  personName?: string;
  thumbnailBase64?: string;
  x: number; y: number; width: number; height: number;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(DetectionEvent)
    private readonly repo: Repository<DetectionEvent>,
  ) {}

  create(dto: CreateEventDto): Promise<DetectionEvent> {
    const event = this.repo.create(dto);
    return this.repo.save(event);
  }

  findAll(filters: {
    plate?: string;
    personId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<[DetectionEvent[], number]> {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.timestamp', 'DESC');

    if (filters.plate) qb.andWhere('e.plateText LIKE :plate', { plate: `%${normalizePlate(filters.plate)}%` });
    if (filters.personId) qb.andWhere('e.personId = :personId', { personId: filters.personId });
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
    startDate.setDate(startDate.getDate() - days);

    const qb = this.repo.createQueryBuilder('e')
      .select("strftime('%Y-%m-%d %H:00:00', e.timestamp)", 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('e.timestamp >= :start', { start: startDate })
      .groupBy('hour')
      .orderBy('hour', 'ASC');

    const raw = await qb.getRawMany();
    return raw.map(r => ({ time: r.hour, count: parseInt(r.count, 10) }));
  }

  async getTopPlates(limit = 10) {
    return this.repo.createQueryBuilder('e')
      .select('e.plateText', 'plate')
      .addSelect('COUNT(*)', 'count')
      .groupBy('e.plateText')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();
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

  delete(id: string) {
    return this.repo.delete(id);
  }
}
