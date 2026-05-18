import { randomUUID } from 'crypto';
import { PlateDto } from '../alpr/dto/plate-result.dto';

interface Reading {
  plate: PlateDto;
  area: number; // bounding box px area — largest = closest to camera = clearest read
}

interface VehicleTrack {
  id: string;
  readings: Reading[];
  lastCentroidX: number;
  lastCentroidY: number;
  lastWidth: number;
  lastHeight: number;
  lastSeen: number;
  firstCentroidX: number;
}

function cx(p: PlateDto) { return p.boundingBox.x + p.boundingBox.width / 2; }
function cy(p: PlateDto) { return p.boundingBox.y + p.boundingBox.height / 2; }

function isNearby(
  plateX: number, plateY: number, plateW: number, plateH: number,
  track: VehicleTrack,
): boolean {
  const refW = Math.max(plateW, track.lastWidth);
  const refH = Math.max(plateH, track.lastHeight);
  const dx = Math.abs(plateX - track.lastCentroidX);
  const dy = Math.abs(plateY - track.lastCentroidY);
  // Allow up to 4× plate dimension — handles vehicle approaching (plate grows 2-3×)
  return dx < refW * 4 && dy < refH * 4;
}

function direction(firstX: number, lastX: number): 'left' | 'right' | 'stationary' {
  const d = lastX - firstX;
  if (Math.abs(d) < 40) return 'stationary';
  return d > 0 ? 'right' : 'left';
}

/**
 * Tracks vehicles across frames by spatial position.
 * Assigns each unique vehicle a UUID and picks the single best plate reading
 * (largest bounding box = vehicle is closest = sharpest image).
 *
 * Unlike PlateTracker, matching is purely spatial — text similarity is not used.
 * This means wrong OCR from far away and correct OCR from close up are correctly
 * merged into a single track, and only the close-up reading is ever committed.
 *
 * idleMs: how long after the last observation before a track is committed.
 * minReadings: minimum observations before a track is considered real (suppresses ghosts).
 */
export class VehicleTracker {
  private readonly tracks = new Map<string, VehicleTrack>();

  constructor(
    private readonly idleMs = 8_000,
    private readonly minReadings = 2,
  ) {}

  /** Feed a plate observation. Returns any tracks that have just been committed (idle). */
  observe(plate: PlateDto): PlateDto[] {
    const now = Date.now();
    const committed = this.flushExpired(now);

    const px = cx(plate), py = cy(plate);
    const area = plate.boundingBox.width * plate.boundingBox.height;

    let track: VehicleTrack | undefined;
    for (const t of this.tracks.values()) {
      if (isNearby(px, py, plate.boundingBox.width, plate.boundingBox.height, t)) {
        track = t;
        break;
      }
    }

    if (!track) {
      track = {
        id: randomUUID(),
        readings: [],
        lastCentroidX: px,
        lastCentroidY: py,
        lastWidth: plate.boundingBox.width,
        lastHeight: plate.boundingBox.height,
        lastSeen: now,
        firstCentroidX: px,
      };
      this.tracks.set(track.id, track);
    } else {
      track.lastCentroidX = px;
      track.lastCentroidY = py;
      track.lastWidth  = plate.boundingBox.width;
      track.lastHeight = plate.boundingBox.height;
    }

    track.readings.push({ plate, area });
    track.lastSeen = now;

    return committed;
  }

  /** Flush all remaining tracks (call when video ends). */
  flushAll(): PlateDto[] {
    const results: PlateDto[] = [];
    for (const [id, track] of this.tracks) {
      if (track.readings.length >= this.minReadings) {
        results.push(this.pickBest(track));
      }
      this.tracks.delete(id);
    }
    return results;
  }

  private flushExpired(now: number): PlateDto[] {
    const results: PlateDto[] = [];
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen >= this.idleMs) {
        if (track.readings.length >= this.minReadings) {
          results.push(this.pickBest(track));
        }
        this.tracks.delete(id);
      }
    }
    return results;
  }

  private pickBest(track: VehicleTrack): PlateDto {
    // Best = largest bounding box area (closest to camera), confidence as tiebreaker
    let best = track.readings[0];
    for (const r of track.readings) {
      if (r.area > best.area || (r.area === best.area && r.plate.confidence > best.plate.confidence)) {
        best = r;
      }
    }
    const plate = { ...best.plate };
    plate.direction = direction(track.firstCentroidX, track.lastCentroidX);
    return plate;
  }
}
