import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like } from 'typeorm';
import { DetectionEvent } from './detection-event.entity';

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

    if (filters.plate) qb.andWhere('e.plateText LIKE :plate', { plate: `%${filters.plate.toUpperCase()}%` });
    if (filters.personId) qb.andWhere('e.personId = :personId', { personId: filters.personId });
    if (filters.startDate) qb.andWhere('e.timestamp >= :start', { start: new Date(filters.startDate) });
    if (filters.endDate) qb.andWhere('e.timestamp <= :end', { end: new Date(filters.endDate) });

    qb.take(filters.limit ?? 50).skip(filters.offset ?? 0);
    return qb.getManyAndCount();
  }

  findByPerson(personId: string): Promise<DetectionEvent[]> {
    return this.repo.find({
      where: { personId },
      order: { timestamp: 'DESC' },
      take: 100,
    });
  }

  delete(id: string) {
    return this.repo.delete(id);
  }
}
