import { nudgeLevel } from './nudge.ts';

/**
 * Per-party state, keyed "main" or by agent id: the last context reading, the
 * focus its model armed, the last nudge level sent, and whether its stop on a
 * marker was refused.
 */
export class Parties {
  private readonly readings = new Map<string, number>();
  private readonly focuses = new Map<string, string>();
  private readonly levels = new Map<string, number>();
  private readonly refused = new Set<string>();

  reading(key: string): number | undefined {
    return this.readings.get(key);
  }

  read(key: string, tokens: number): void {
    this.readings.set(key, tokens);
  }

  armed(key: string): string | undefined {
    return this.focuses.get(key);
  }

  arm(key: string, focus: string): void {
    this.focuses.set(key, focus);
  }

  continued(key: string): boolean {
    return this.refused.has(key);
  }

  markContinued(key: string): void {
    this.refused.add(key);
  }

  /** The nudge level owed at the last reading, recorded as sent; undefined when none is owed or the party is armed. */
  nudgeDue(key: string, start: number, every: number): number | undefined {
    const tokens = this.readings.get(key);
    if (tokens === undefined || this.focuses.has(key)) return undefined;
    const level = nudgeLevel(tokens, start, every);
    if (level < 0 || level <= (this.levels.get(key) ?? -1)) return undefined;
    this.levels.set(key, level);
    return level;
  }

  /**
   * After a compaction ran: the reading becomes the size after it (0 when none
   * was reported), so a tool call that lands before the next response reads no
   * stale figure; the armed focus, the nudges and the refused stop start over.
   */
  compacted(key: string, tokensAfter: number | undefined): void {
    this.readings.set(key, tokensAfter ?? 0);
    this.focuses.delete(key);
    this.levels.delete(key);
    this.refused.delete(key);
  }
}
