import { PlateDto } from '../alpr/dto/plate-result.dto';

interface VoteEntry {
  count: number;
  best: PlateDto;
}

interface Session {
  /** The plate text of the first observation — used as the fuzzy-match key. */
  anchorText: string;
  votes: Map<string, VoteEntry>;
  totalVotes: number;
  lastSeen: number;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  // Fast reject: length difference alone exceeds threshold
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

/**
 * Groups multi-frame plate observations by OCR similarity and returns a single
 * "committed" winner per vehicle pass once the car leaves the frame.
 *
 * - commitAfterMs: how long after the last sighting to flush a session (default 5s)
 * - maxEditDistance: OCR typos to tolerate when grouping (default 2 chars)
 */
export class PlateTracker {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly commitAfterMs = 5_000,
    private readonly maxEditDistance = 2,
  ) {}

  /**
   * Record one plate observation. Returns any sessions that have been idle
   * long enough to be committed (these should be logged to the DB).
   */
  observe(plate: PlateDto): PlateDto[] {
    const now = Date.now();
    const committed = this.flushExpired(now);

    let matched: Session | undefined;
    for (const session of this.sessions.values()) {
      if (levenshtein(plate.text, session.anchorText) <= this.maxEditDistance) {
        matched = session;
        break;
      }
    }

    if (!matched) {
      matched = { anchorText: plate.text, votes: new Map(), totalVotes: 0, lastSeen: now };
      this.sessions.set(plate.text + '_' + now, matched);
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

    return committed;
  }

  /** Force-commit all open sessions (call when stream ends). */
  flushAll(): PlateDto[] {
    const results: PlateDto[] = [];
    for (const [key, session] of this.sessions) {
      results.push(this.pickWinner(session));
      this.sessions.delete(key);
    }
    return results;
  }

  private flushExpired(now: number): PlateDto[] {
    const results: PlateDto[] = [];
    for (const [key, session] of this.sessions) {
      if (now - session.lastSeen >= this.commitAfterMs) {
        results.push(this.pickWinner(session));
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
    return winner!.best;
  }
}
