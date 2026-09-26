import { describe, expect, it } from 'vitest';
import { appendRows, sessionLogPath } from '../plugins/sub-agent-compact/src/log.ts';

describe('sessionLogPath', () => {
  it.each([
    ['/tmp/sac/decisions.jsonl', 'abc-123', '/tmp/sac/decisions.abc-123.jsonl'],
    ['/tmp/sac/decisions', 'abc-123', '/tmp/sac/decisions.abc-123'],
    ['/tmp/sac.d/decisions', 'abc', '/tmp/sac.d/decisions.abc'],
    ['/tmp/sac/.decisions', 'abc', '/tmp/sac/.decisions.abc'],
    ['/tmp/sac/a.b.jsonl', 'abc', '/tmp/sac/a.b.abc.jsonl'],
  ])('%s + %s → %s', (file, session, path) => {
    expect(sessionLogPath(file, session)).toBe(path);
  });

  it('keeps a session id from escaping the log directory', () => {
    expect(sessionLogPath('/tmp/sac/decisions.jsonl', '../../etc/x y')).toBe('/tmp/sac/decisions.______etc_x_y.jsonl');
  });

  it('rejects an empty session id', () => {
    expect(() => sessionLogPath('/tmp/sac/decisions.jsonl', '')).toThrow(/empty session id/);
  });
});

describe('appendRows', () => {
  it('keeps the rows already in the file and appends the new ones', () => {
    expect(appendRows('{"a":1}\n{"a":2}\n', ['{"a":3}'], 10)).toBe('{"a":1}\n{"a":2}\n{"a":3}\n');
  });

  it('starts a missing or empty file', () => {
    expect(appendRows('', ['{"a":1}'], 10)).toBe('{"a":1}\n');
  });

  it('drops blank lines and keeps only the newest rows past the cap', () => {
    expect(appendRows('{"a":1}\n\n{"a":2}', ['{"a":3}', '{"a":4}'], 3)).toBe('{"a":2}\n{"a":3}\n{"a":4}\n');
  });
});
