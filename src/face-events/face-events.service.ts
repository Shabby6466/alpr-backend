import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FaceEvent } from './face-event.entity';

export interface CreateFaceEventDto {
  personId?: string;
  personName?: string;
  confidence: number;
  quality: number;
  spoofScore?: number;
  spoofDetected?: boolean;
  occluded?: boolean;
  thumbnailBase64?: string;
  cameraId?: string;
  cameraName?: string;
  detectionEventId?: string;
  x: number; y: number; width: number; height: number;
}

@Injectable()
export class FaceEventsService {
  constructor(
    @InjectRepository(FaceEvent)
    private readonly repo: Repository<FaceEvent>,
  ) {}

  create(dto: CreateFaceEventDto): Promise<FaceEvent> {
    const event = this.repo.create({
      spoofDetected: false,
      occluded: false,
      ...dto,
    });
    return this.repo.save(event);
  }

  findAll(filters: {
    personId?: string;
    cameraId?: string;
    spoofOnly?: boolean;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<[FaceEvent[], number]> {
    const qb = this.repo.createQueryBuilder('f').orderBy('f.timestamp', 'DESC');
    if (filters.personId) qb.andWhere('f.personId = :personId', { personId: filters.personId });
    if (filters.cameraId) qb.andWhere('f.cameraId = :cameraId', { cameraId: filters.cameraId });
    if (filters.spoofOnly) qb.andWhere('f.spoofDetected = 1');
    if (filters.startDate) qb.andWhere('f.timestamp >= :start', { start: new Date(filters.startDate) });
    if (filters.endDate) qb.andWhere('f.timestamp <= :end', { end: new Date(filters.endDate) });
    qb.take(filters.limit ?? 50).skip(filters.offset ?? 0);
    return qb.getManyAndCount();
  }

  delete(id: string) { return this.repo.delete(id); }

  deleteOlderThan(cutoff: Date) {
    return this.repo.createQueryBuilder().delete().where('timestamp < :cutoff', { cutoff }).execute();
  }
}
