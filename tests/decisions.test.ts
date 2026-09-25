import { describe, expect, it } from 'vitest';
import { AgentLimits, type AgentFs } from '../src/agents.ts';
import { contextTokens, currentTokens, decide, estimateTranscript } from '../src/decide.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import { DEFAULT_MAIN_AUTO_COMPACT, DEFAULT_SUBAGENT_AUTO_COMPACT, parseLimit, resolveOptions } from '../src/limits.ts';

describe('parseLimit', () => {
  it.each([
    [150000, 150000],
    ['150000', 150000],
    ['150k', 150000],
    ['150K', 150000],
    ['0.6m', 600000],
    ['1.5M', 1500000],
    [' 200k ', 200000],
    ['200_000', 200000],
  ])('%j → %d', (raw, value) => {
    expect(parseLimit(raw)).toEqual({ ok: true, value });
  });

  it.each([['abc'], ['150kb'], ['-5'], ['0'], [''], [0], [-1], [Number.NaN], [true], [null]])('%j is an error', (raw) => {
    const parsed = parseLimit(raw);
    expect(parsed.ok).toBe(false);
  });
});

describe('resolveOptions', () => {
  it('defaults when nothing is set', () => {
    expect(resolveOptions({})).toEqual({
      mainAutoCompact: DEFAULT_MAIN_AUTO_COMPACT,
      subagentAutoCompact: DEFAULT_SUBAGENT_AUTO_COMPACT,
      agentDirs: [],
      errors: [],
    });
  });

  it('reads suffixed values, dir lists and an absolute log file', () => {
    const options = resolveOptions({ mainAutoCompact: '0.6m', subagentAutoCompact: '90k', agentDirs: 'a, /b/c ,', logFile: '/tmp/x.jsonl' });
    expect(options).toEqual({ mainAutoCompact: 600000, subagentAutoCompact: 90000, agentDirs: ['a', '/b/c'], logFile: '/tmp/x.jsonl', errors: [] });
    expect(resolveOptions({ agentDirs: ['/x', ' /y '] }).agentDirs).toEqual(['/x', '/y']);
  });

  it('falls back on a bad value and names it, never silently', () => {
    const options = resolveOptions({ mainAutoCompact: 'lots', subagentAutoCompact: '-3', logFile: 'relative.jsonl' });
    expect(options.mainAutoCompact).toBe(DEFAULT_MAIN_AUTO_COMPACT);
    expect(options.subagentAutoCompact).toBe(DEFAULT_SUBAGENT_AUTO_COMPACT);
    expect(options.logFile).toBeUndefined();
    expect(options.errors).toHaveLength(3);
    expect(options.errors[0]).toMatch(/mainAutoCompact is invalid.*"lots".*600000/);
    expect(options.errors[1]).toMatch(/subagentAutoCompact is invalid/);
    expect(options.errors[2]).toMatch(/logFile must be an absolute path/);
  });
});

describe('parseFrontmatter', () => {
  it('reads top-level scalars', () => {
    const text = '---\nname: big-reader\ndescription: "reads: files"\nautoCompact: 130k # tokens\ntools:\n  - Read\n---\nbody autoCompact: 1\n';
    expect(parseFrontmatter(text)).toEqual({ name: 'big-reader', description: 'reads: files', autoCompact: '130k', tools: '' });
  });

  it('is empty without a leading or closing fence', () => {
    expect(parseFrontmatter('name: x\n')).toEqual({});
    expect(parseFrontmatter('---\nname: x\n')).toEqual({});
  });

  it('handles CRLF and a BOM', () => {
    expect(parseFrontmatter('﻿---\r\nautoCompact: 2m\r\n---\r\n')).toEqual({ autoCompact: '2m' });
  });
});

describe('decide', () => {
  it('always passes manual and plugin triggers', () => {
    expect(decide({ trigger: 'manual', label: 'main', limit: 100, tokens: 1 })).toEqual({ action: 'pass', why: 'requested' });
    expect(decide({ trigger: 'plugin', label: 'x', limit: 100, tokens: undefined })).toEqual({ action: 'pass', why: 'requested' });
  });

  it('holds auto and precompute below the limit, with the reason', () => {
    expect(decide({ trigger: 'auto', label: 'big-reader', limit: 130000, tokens: 101000 })).toEqual({
      action: 'skip',
      reason: 'sub-agent-compact: big-reader held below 130000 (now 101000)',
    });
    expect(decide({ trigger: 'precompute', label: 'main', limit: 10, tokens: 9 }).action).toBe('skip');
  });

  it('passes at and above the limit', () => {
    expect(decide({ trigger: 'auto', label: 'main', limit: 150000, tokens: 150000 })).toEqual({ action: 'pass', why: 'at-limit' });
    expect(decide({ trigger: 'precompute', label: 'main', limit: 150000, tokens: 200000 }).action).toBe('pass');
  });

  it('never holds without a reading', () => {
    expect(decide({ trigger: 'auto', label: 'x', limit: 100, tokens: undefined })).toEqual({ action: 'pass', why: 'no-reading' });
    expect(decide({ trigger: 'auto', label: 'x', limit: 100, tokens: Number.NaN })).toEqual({ action: 'pass', why: 'no-reading' });
  });
});

describe('contextTokens', () => {
  it('sums input, cache read and cache creation', () => {
    expect(contextTokens({ input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })).toBe(125);
    expect(contextTokens(null)).toBeUndefined();
    expect(contextTokens({})).toBeUndefined();
  });
});

function memoryFs(files: Record<string, string>, failing: string[] = []): AgentFs & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    exists: async (path) => path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`)),
    read: async (path) => {
      reads.push(path);
      if (failing.includes(path)) throw new Error('EACCES');
      const text = files[path];
      if (text === undefined) throw new Error('ENOENT');
      return text;
    },
    listMarkdown: async (dir) =>
      Object.keys(files)
        .filter((file) => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/') && file.endsWith('.md'))
        .map((file) => file.slice(dir.length + 1)),
  };
}

describe('AgentLimits', () => {
  const agent = (name: string, autoCompact?: string) => `---\nname: ${name}\n${autoCompact ? `autoCompact: ${autoCompact}\n` : ''}---\nbody\n`;

  it('finds <type>.md in directory order, project first', async () => {
    const fs = memoryFs({ '/p/.claude/agents/big-reader.md': agent('big-reader', '130k'), '/h/.claude/agents/big-reader.md': agent('big-reader', '50k') });
    const limits = new AgentLimits(['/p/.claude/agents', '/h/.claude/agents'], 150000, fs, () => {});
    expect(await limits.resolve('big-reader')).toEqual({ limit: 130000, source: '/p/.claude/agents/big-reader.md' });
  });

  it('matches by frontmatter name when the filename differs, and caches', async () => {
    const fs = memoryFs({ '/extra/reader-v2.md': agent('big-reader', '0.2m'), '/extra/other.md': agent('other') });
    const limits = new AgentLimits(['/p/.claude/agents', '/extra'], 150000, fs, () => {});
    expect(await limits.resolve('big-reader')).toEqual({ limit: 200000, source: '/extra/reader-v2.md' });
    const readsAfterFirst = fs.reads.length;
    await limits.resolve('big-reader');
    expect(fs.reads.length).toBe(readsAfterFirst);
  });

  it('skips a <type>.md whose name: names another agent', async () => {
    const fs = memoryFs({ '/d/reader.md': agent('writer', '10k'), '/d/x.md': agent('reader', '20k') });
    const limits = new AgentLimits(['/d'], 150000, fs, () => {});
    expect(await limits.resolve('reader')).toEqual({ limit: 20000, source: '/d/x.md' });
  });

  it('gives built-ins and definitions without autoCompact the default', async () => {
    const fs = memoryFs({ '/d/plain.md': agent('plain') });
    const limits = new AgentLimits(['/d'], 150000, fs, () => {});
    expect(await limits.resolve('general-purpose')).toEqual({ limit: 150000, source: 'default' });
    expect(await limits.resolve('plain')).toEqual({ limit: 150000, source: 'default' });
  });

  it('logs a bad autoCompact or an unreadable file and falls back', async () => {
    const lines: string[] = [];
    const fs = memoryFs({ '/d/bad.md': agent('bad', 'huge'), '/d/locked.md': agent('locked', '10k') }, ['/d/locked.md']);
    const limits = new AgentLimits(['/d'], 150000, fs, (line) => lines.push(line));
    expect(await limits.resolve('bad')).toEqual({ limit: 150000, source: 'default' });
    expect(await limits.resolve('locked')).toEqual({ limit: 150000, source: 'default' });
    expect(lines.some((line) => /\/d\/bad\.md autoCompact for bad is invalid/.test(line))).toBe(true);
    expect(lines.some((line) => /reading \/d\/locked\.md failed: Error: EACCES/.test(line))).toBe(true);
  });
});

describe('currentTokens', () => {
  const file = 'x'.repeat(35_000); // ~10k tokens
  const transcript = [
    { text: 'read the files', toolUses: [], toolResults: [] },
    { text: '', toolUses: [{ tool_use_id: 't1', input: { file_path: 'a.go' }, text: file }, { tool_use_id: 't2', input: { file_path: 'b.go' }, text: file }] },
    { text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: file }, { tool_use_id: 't2', text: file }] },
  ];

  it('counts each tool result once', () => {
    const tokens = estimateTranscript(transcript);
    expect(tokens).toBeGreaterThan(20_000);
    expect(tokens).toBeLessThan(20_100);
  });

  it('counts a call whose answer is missing by its own text', () => {
    expect(estimateTranscript([transcript[1]!])).toBeGreaterThan(20_000);
  });

  it('sees tool results the last response usage has not (the one-step lag)', () => {
    // live: a sub-agent's last response read 59k while two parallel reads had just added ~80k
    expect(currentTokens(5_000, transcript)).toBe(estimateTranscript(transcript));
  });

  it('keeps the usage when it is the larger, undefined without one', () => {
    expect(currentTokens(90_000, transcript)).toBe(90_000);
    expect(currentTokens(undefined, transcript)).toBeUndefined();
  });
});
