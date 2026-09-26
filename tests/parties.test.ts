import { describe, expect, it } from 'vitest';
import { Parties } from '../plugins/sub-agent-compact/src/parties.ts';

describe('Parties', () => {
  it('owes each nudge level once, and none while armed', () => {
    const parties = new Parties();
    parties.read('a', 105_000);
    expect(parties.nudgeDue('a', 100_000, 100_000)).toBe(0);
    expect(parties.nudgeDue('a', 100_000, 100_000)).toBeUndefined();
    parties.read('a', 210_000);
    parties.arm('a', 'next: file 9');
    expect(parties.nudgeDue('a', 100_000, 100_000)).toBeUndefined();
  });

  it('starts a compacted party over from its size after the compaction, so a stale reading sends no nudge', () => {
    const parties = new Parties();
    parties.read('a', 104_000);
    expect(parties.nudgeDue('a', 100_000, 100_000)).toBe(0);
    parties.arm('a', 'next: file 9');
    parties.markContinued('a');
    parties.compacted('a', 10_000);
    expect(parties.reading('a')).toBe(10_000);
    expect(parties.armed('a')).toBeUndefined();
    expect(parties.continued('a')).toBe(false);
    expect(parties.nudgeDue('a', 100_000, 100_000)).toBeUndefined();
    parties.read('a', 101_000);
    expect(parties.nudgeDue('a', 100_000, 100_000)).toBe(0);
  });

  it('reads 0 after a compaction that reported no size, never the stale figure', () => {
    const parties = new Parties();
    parties.read('a', 104_000);
    parties.compacted('a', undefined);
    expect(parties.reading('a')).toBe(0);
  });
});
