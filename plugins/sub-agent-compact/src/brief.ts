// A sub-agent's brief is the first user message of its own loop: the prompt its parent passed.
// Claude Code replaces it with the summary at a compaction, so the exact paths, acceptance rows and
// standing rules fall to a paraphrase. This puts it back right after the summary, verbatim.

/** The parts of a transcript message this module reads (the plugin API's SessionMessage satisfies it). */
export type BriefMessage = {
  role: 'user' | 'assistant';
  text: string;
  toolUses: readonly unknown[];
  toolResults?: readonly unknown[];
  handle?: string;
};

/** Opens the seated message: how a later compaction finds the copy it seated, and tells the model what it is reading. */
export const BRIEF_MARKER = '[original task brief of this sub-agent, kept verbatim by sub-agent-compact]';

/** Codex's bound on the user messages it keeps verbatim. */
export const BRIEF_MAX_TOKENS = 64_000;

/** Characters per token of the size estimate. */
const CHARS_PER_TOKEN = 4;

/** How Claude Code opens the summary it seats as the first message after a compaction. */
const SUMMARY_OPENING = 'This session is being continued from a previous conversation';

const isPlainUser = (m: BriefMessage): boolean => m.role === 'user' && m.toolUses.length === 0 && !m.toolResults?.length;
const isSeated = (m: BriefMessage): boolean => isPlainUser(m) && m.text.startsWith(`${BRIEF_MARKER}\n`);

/** The seated message's text: the marker, the brief, and past the bound its head and one line saying where it was cut. */
function seatedText(brief: string, maxTokens: number): string {
  const maxChars = Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (brief.length <= maxChars) return `${BRIEF_MARKER}\n${brief}`;
  let head = brief.slice(0, maxChars);
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return `${BRIEF_MARKER}\n${head}\n[sub-agent-compact: the brief was cut at ${maxTokens} tokens (${head.length} characters) of ${brief.length} characters]`;
}

/**
 * The messages a sub-agent's compaction leaves, with its brief seated directly after the summary.
 *
 * `input` is the transcript that was compacted, `output` what the compaction left (the summary first, then
 * what the engine kept). The brief is the input's first user message, or the copy an earlier compaction
 * seated, which is carried over as it is: a brief is cut once and never again, and the output holds
 * exactly one copy however many compactions have run. `output` itself is returned when there is nothing
 * to seat: no brief in the input, or no summary to follow.
 */
export function reseatBrief<M extends BriefMessage>(input: readonly M[], output: readonly M[], maxTokens: number): readonly M[] {
  let seated: string | undefined;
  let original: string | undefined;
  const earlier = input.find(isSeated);
  if (earlier) seated = earlier.text;
  else {
    const first = input[0];
    if (first && isPlainUser(first) && first.text.trim() !== '' && !first.text.startsWith(SUMMARY_OPENING)) {
      original = first.text;
      seated = seatedText(first.text, maxTokens);
    }
  }
  const summary = output[0];
  if (seated === undefined || !summary || !isPlainUser(summary) || isSeated(summary)) return output;
  const kept = output.slice(1).filter((m) => !(isSeated(m) || (original !== undefined && isPlainUser(m) && m.text === original)));
  return [summary, { role: 'user', text: seated, toolUses: [] } as BriefMessage as M, ...kept];
}
