import { PlateDto } from '../alpr/dto/plate-result.dto';

interface VoteEntry {
  count: number;
  best: PlateDto;
}

interface Session {
  anchorText: string;
  votes: Map<string, VoteEntry>;
  totalVotes: number;
  lastSeen: number;
  firstCentroidX: number;
  lastCentroidX: number;
  lastCentroidY: number;
  lastWidth: number;
  lastHeight: number;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function centroidX(plate: PlateDto): number {
  return plate.boundingBox.x + plate.boundingBox.width / 2;
}

function centroidY(plate: PlateDto): number {
  return plate.boundingBox.y + plate.boundingBox.height / 2;
}

function computeDirection(firstX: number, lastX: number): 'left' | 'right' | 'stationary' {
  const delta = lastX - firstX;
  if (Math.abs(delta) < 40) return 'stationary';
  return delta > 0 ? 'right' : 'left';
}

/**
 * Matches an incoming plate to an existing session using two criteria:
 *
 * 1. OCR similarity — Levenshtein distance ≤ maxEditDistance (catches minor misreads)
 * 2. Spatial proximity — centroid within K×plate-size of the session's last position
 *    (catches cases where the same physical plate was misread badly from a distance,
 *    producing a text too different to match by edit distance alone)
 *
 * Spatial match uses a generous 4× multiplier so a plate that doubles in size
 * (vehicle halves its distance) still matches the same session.
 */
function spatiallyClose(plate: PlateDto, session: Session): boolean {
  const cx = centroidX(plate);
  const cy = centroidY(plate);
  // Use the larger of incoming/session plate dimensions as the proximity scale
  const refW = Math.max(plate.boundingBox.width, session.lastWidth);
  const refH = Math.max(plate.boundingBox.height, session.lastHeight);
  const dx = Math.abs(cx - session.lastCentroidX);
  const dy = Math.abs(cy - session.lastCentroidY);
  return dx < refW * 4 && dy < refH * 4;
}

/**
 * Groups multi-frame plate observations into sessions, commits the best reading
 * per session once it has been idle for commitAfterMs.
 *
 * A session is only committed when it has accumulated at least minObservations —
 * this suppresses single low-confidence shots from far-away plates that would
 * otherwise be logged before the vehicle comes close enough to read correctly.
 *
 * If a session expires without reaching minObservations, it is silently dropped.
 */
export class PlateTracker {
  private readonly sessions = new Map<string, Session>();
  private log: (msg: string) => void = () => {};

  setLogger(fn: (msg: string) => void) { this.log = fn; }

  constructor(
    private readonly commitAfterMs = 5_000,
    private readonly maxEditDistance = 2,
    private readonly minObservations = 3,
  ) {}

  observe(plate: PlateDto): PlateDto[] {
    const now = Date.now();
    const committed = this.flushExpired(now);
    const cx = centroidX(plate);
    const cy = centroidY(plate);

    let matched: Session | undefined;
    let matchedKey: string | undefined;
    for (const [k, session] of this.sessions) {
      if (
        levenshtein(plate.text, session.anchorText) <= this.maxEditDistance ||
        spatiallyClose(plate, session)
      ) {
        matched = session;
        matchedKey = k;
        break;
      }
    }

    if (!matched) {
      const key = plate.text + '_' + now;
      matched = {
        anchorText: plate.text,
        votes: new Map(),
        totalVotes: 0,
        lastSeen: now,
        firstCentroidX: cx,
        lastCentroidX: cx,
        lastCentroidY: cy,
        lastWidth: plate.boundingBox.width,
        lastHeight: plate.boundingBox.height,
      };
      this.sessions.set(key, matched);
      matchedKey = key;
      this.log(`    [TRACKER NEW session] "${plate.text}" (need ${this.minObservations} obs)`);
    } else {
      matched.lastCentroidX = cx;
      matched.lastCentroidY = cy;
      matched.lastWidth = plate.boundingBox.width;
      matched.lastHeight = plate.boundingBox.height;
      this.log(`    [TRACKER UPDATE] "${plate.text}" obs=${matched.totalVotes + 1}/${this.minObservations}`);
    }

    const existing = matched.votes.get(plate.text);
    if (existing) {
      existing.count++;
      if (plate.confidence > existing.best.confidence) existing.best = plate;
    } else {
      matched.votes.set(plate.text, { count: 1, best: plate });
    }
    matched.totalVotes++;
    matched.lastSeen = now;

    // Commit as soon as minObservations is reached — don't wait for idle.
    // The session is removed immediately so the next pass starts a fresh one.
    // logCommitted's cooldown gate handles re-logging rate-limiting.
    if (matched.totalVotes >= this.minObservations) {
      const winner = this.pickWinner(matched);
      this.log(`    [TRACKER COMMIT] "${winner.text}" after ${matched.totalVotes} obs → sending to logCommitted`);
      committed.push(winner);
      this.sessions.delete(matchedKey!);
    }

    return committed;
  }

  flushAll(): PlateDto[] {
    const results: PlateDto[] = [];
    for (const [key, session] of this.sessions) {
      if (session.totalVotes >= this.minObservations) {
        results.push(this.pickWinner(session));
      }
      this.sessions.delete(key);
    }
    return results;
  }

  private flushExpired(now: number): PlateDto[] {
    const results: PlateDto[] = [];
    for (const [key, session] of this.sessions) {
      if (now - session.lastSeen >= this.commitAfterMs) {
        if (session.totalVotes >= this.minObservations) {
          results.push(this.pickWinner(session));
          this.log(`    [TRACKER EXPIRED COMMIT] "${session.anchorText}" obs=${session.totalVotes} idle>${this.commitAfterMs}ms`);
        } else {
          this.log(`    [TRACKER EXPIRED DROP] "${session.anchorText}" only ${session.totalVotes} obs (need ${this.minObservations}) — dropped`);
        }
        this.sessions.delete(key);
      }
    }
    return results;
  }

  private pickWinner(session: Session): PlateDto {
    let winner: VoteEntry | undefined;
    for (const entry of session.votes.values()) {
      if (
        !winner ||
        entry.count > winner.count ||
        (entry.count === winner.count && entry.best.confidence > winner.best.confidence)
      ) {
        winner = entry;
      }
    }
    const plate = { ...winner!.best };
    plate.direction = computeDirection(session.firstCentroidX, session.lastCentroidX);
    return plate;
  }
}
