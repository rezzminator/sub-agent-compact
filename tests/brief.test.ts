import { describe, expect, it } from 'vitest';
import { BRIEF_MARKER, BRIEF_MAX_TOKENS, reseatBrief, type BriefMessage } from '../plugins/sub-agent-compact/src/brief.ts';

const BRIEF = [
  'standing rule: never edit /srv/zebra/quokka-01.cfg without a backup',
  'acceptance row A7: the ledger total equals 4417 after the import',
  'exact path to read first: /opt/marmot/stage/ridge-0042/manifest.json',
].join('\n');

const SUMMARY_TEXT = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion.';

const user = (text: string, handle?: string): BriefMessage => ({ role: 'user', text, toolUses: [], ...(handle ? { handle } : {}) });
const assistant = (text: string, handle?: string): BriefMessage => ({ role: 'assistant', text, toolUses: [], ...(handle ? { handle } : {}) });
const toolReply = (handle: string): BriefMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }], handle });

const copies = (messages: readonly BriefMessage[], line: string): number => messages.filter((m) => m.text.includes(line)).length;
const seated = (messages: readonly BriefMessage[]): BriefMessage[] => messages.filter((m) => m.text.startsWith(BRIEF_MARKER));

describe('reseatBrief', () => {
  it('seats the first user message, verbatim, directly after the summary', () => {
    const input = [user(BRIEF, 'h1'), assistant('', 'h2'), toolReply('h3'), assistant('next', 'h4')];
    const output = [user(SUMMARY_TEXT), assistant('next', 'h4')];
    const result = reseatBrief(input, output, BRIEF_MAX_TOKENS);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(output[0]);
    expect(result[1]!.role).toBe('user');
    expect(result[1]!.text).toBe(`${BRIEF_MARKER}\n${BRIEF}`);
    expect(result[2]).toBe(output[1]);
    for (const line of BRIEF.split('\n')) expect(copies(result, line)).toBe(1);
  });

  it('keeps exactly one copy across a second and a third compaction', () => {
    const first = reseatBrief([user(BRIEF, 'h1'), assistant('a', 'h2')], [user(SUMMARY_TEXT), assistant('a', 'h2')], BRIEF_MAX_TOKENS);
    expect(first).toHaveLength(3);
    const secondInput = [{ ...first[0]!, handle: 's1' }, { ...first[1]!, handle: 'b1' }, assistant('later work', 'h5')];
    const second = reseatBrief(secondInput, [user(`${SUMMARY_TEXT} second`), assistant('later work', 'h5')], BRIEF_MAX_TOKENS);
    expect(second).toHaveLength(3);
    expect(seated(second)).toHaveLength(1);
    expect(second[1]!.text).toBe(`${BRIEF_MARKER}\n${BRIEF}`);
    const thirdInput = [{ ...second[0]!, handle: 's2' }, { ...second[1]!, handle: 'b2' }, assistant('even later', 'h6')];
    const third = reseatBrief(thirdInput, [user(`${SUMMARY_TEXT} third`), assistant('even later', 'h6')], BRIEF_MAX_TOKENS);
    expect(seated(third)).toHaveLength(1);
    for (const line of BRIEF.split('\n')) expect(copies(third, line)).toBe(1);
  });

  it('never takes the summary for the brief when the seated copy is gone from the input', () => {
    const input = [user(SUMMARY_TEXT, 's1'), assistant('work', 'h2')];
    const output = [user(`${SUMMARY_TEXT} again`), assistant('work', 'h2')];
    expect(reseatBrief(input, output, BRIEF_MAX_TOKENS)).toBe(output);
  });

  it('keeps one copy when the engine kept the seated message in its tail', () => {
    const seatedCopy = { ...user(`${BRIEF_MARKER}\n${BRIEF}`), handle: 'b1' };
    const input = [{ ...user(SUMMARY_TEXT), handle: 's1' }, seatedCopy, assistant('x', 'h2')];
    const output = [user('fresh summary'), seatedCopy, assistant('x', 'h2')];
    const result = reseatBrief(input, output, BRIEF_MAX_TOKENS);
    expect(seated(result)).toHaveLength(1);
    expect(result[1]!.text).toBe(`${BRIEF_MARKER}\n${BRIEF}`);
    expect(result).toHaveLength(3);
  });

  it('keeps one copy when the engine kept the original first message in its tail', () => {
    const input = [user(BRIEF, 'h1'), assistant('x', 'h2')];
    const output = [user(SUMMARY_TEXT), user(BRIEF, 'h1'), assistant('x', 'h2')];
    const result = reseatBrief(input, output, BRIEF_MAX_TOKENS);
    expect(result).toHaveLength(3);
    for (const line of BRIEF.split('\n')) expect(copies(result, line)).toBe(1);
    expect(result[1]!.text.startsWith(BRIEF_MARKER)).toBe(true);
  });

  it('cuts a brief past the bound at the bound and says so in one line', () => {
    const long = 'x'.repeat(40) + '\n' + 'y'.repeat(100);
    const result = reseatBrief([user(long, 'h1')], [user(SUMMARY_TEXT)], 10);
    expect(result).toHaveLength(2);
    expect(result[1]!.text).toBe(`${BRIEF_MARKER}\n${long.slice(0, 40)}\n[sub-agent-compact: the brief was cut at 10 tokens (40 characters) of ${long.length} characters]`);
  });

  it('keeps a brief of exactly the bound whole', () => {
    const exact = 'z'.repeat(40);
    const result = reseatBrief([user(exact, 'h1')], [user(SUMMARY_TEXT)], 10);
    expect(result).toHaveLength(2);
    expect(result[1]!.text).toBe(`${BRIEF_MARKER}\n${exact}`);
  });

  it('does not cut an already seated brief again on a later compaction', () => {
    const long = 'x'.repeat(40) + '\n' + 'y'.repeat(100);
    const first = reseatBrief([user(long, 'h1')], [user(SUMMARY_TEXT)], 10);
    expect(first).toHaveLength(2);
    const second = reseatBrief([{ ...first[0]!, handle: 's' }, { ...first[1]!, handle: 'b' }], [user('summary 2')], 10);
    expect(second).toHaveLength(2);
    expect(second[1]!.text).toBe(first[1]!.text);
  });

  it('leaves the output alone when there is no user message to keep or no summary to follow', () => {
    const output = [user(SUMMARY_TEXT)];
    expect(reseatBrief([assistant('hi', 'h1')], output, BRIEF_MAX_TOKENS)).toBe(output);
    expect(reseatBrief([toolReply('h1')], output, BRIEF_MAX_TOKENS)).toBe(output);
    expect(reseatBrief([user('   ', 'h1')], output, BRIEF_MAX_TOKENS)).toBe(output);
    expect(reseatBrief([], output, BRIEF_MAX_TOKENS)).toBe(output);
    const bare = [assistant('x', 'h2')];
    expect(reseatBrief([user(BRIEF, 'h1')], bare, BRIEF_MAX_TOKENS)).toBe(bare);
    expect(reseatBrief([user(BRIEF, 'h1')], [], BRIEF_MAX_TOKENS)).toEqual([]);
  });
});
