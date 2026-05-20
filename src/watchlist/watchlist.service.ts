import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistEntry } from './watchlist.entity';
import { Alert } from './alert.entity';
import { CreateWatchlistDto, UpdateWatchlistDto } from './dto/watchlist.dto';
import { normalizePlate } from '../common/plate.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PersonsService } from '../persons/persons.service';

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistEntry)
    private readonly watchlistRepo: Repository<WatchlistEntry>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly notifications: NotificationsService,
    private readonly persons: PersonsService,
  ) {}

  async create(dto: CreateWatchlistDto): Promise<WatchlistEntry> {
    const normalized = normalizePlate(dto.plateText);
    const existing = await this.watchlistRepo.findOne({ where: { plateText: normalized } });
    if (existing) throw new ConflictException(`Plate ${normalized} is already on the watchlist`);
    const entry = this.watchlistRepo.create({ ...dto, plateText: normalized });
    return this.watchlistRepo.save(entry);
  }

  findAll(activeOnly?: boolean): Promise<WatchlistEntry[]> {
    const where = activeOnly ? { active: true } : {};
    return this.watchlistRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async update(id: string, dto: UpdateWatchlistDto): Promise<WatchlistEntry> {
    const entry = await this.watchlistRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException(`Watchlist entry ${id} not found`);
    Object.assign(entry, dto);
    return this.watchlistRepo.save(entry);
  }

  async remove(id: string) {
    const entry = await this.watchlistRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException(`Watchlist entry ${id} not found`);
    return this.watchlistRepo.remove(entry);
  }

  async checkAndAlert(
    plateText: string,
    detectionEventId?: string,
    thumbnailBase64?: string,
  ): Promise<Alert | null> {
    const normalized = normalizePlate(plateText);
    const entry = await this.watchlistRepo.findOne({ where: { plateText: normalized, active: true } });
    if (!entry) return null;

    // Deduplicate: if an unacknowledged alert for this plate already exists within the last 5 minutes,
    // update it with the real detectionEventId (if we now have one) and re-emit rather than creating a duplicate.
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const recent = await this.alertRepo.findOne({
      where: { plateText: normalized, acknowledged: false },
      order: { timestamp: 'DESC' },
    });
    if (recent && recent.timestamp > cutoff) {
      if (detectionEventId && !recent.detectionEventId) {
        recent.detectionEventId = detectionEventId;
        const updated = await this.alertRepo.save(recent);
        this.notifications.emitAlert(updated);
        return updated;
      }
      // Already has an event ID or no new ID — re-emit for any missed SSE listeners
      this.notifications.emitAlert(recent);
      return recent;
    }

    // Look up associated person for this plate
    const person = await this.persons.findByPlate(normalized).catch(() => null);

    const alert = this.alertRepo.create({
      plateText: normalized,
      watchlistEntryId: entry.id,
      detectionEventId,
      reason: entry.reason,
      thumbnailBase64,
      personName: person?.name,
      personFaceThumbnail: person?.faceThumbnail,
    });
    const saved = await this.alertRepo.save(alert);
    this.notifications.emitAlert(saved);
    return saved;
  }

  getAlerts(acknowledged?: boolean): Promise<Alert[]> {
    const where = acknowledged !== undefined ? { acknowledged } : {};
    return this.alertRepo.find({ where, order: { timestamp: 'DESC' } });
  }

  async acknowledgeAlert(id: string): Promise<Alert> {
    const alert = await this.alertRepo.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);
    alert.acknowledged = true;
    return this.alertRepo.save(alert);
  }

  deleteAlert(id: string) {
    return this.alertRepo.delete(id);
  }
}
