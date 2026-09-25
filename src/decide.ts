export type Trigger = 'manual' | 'auto' | 'plugin' | 'precompute';

export type DecideInput = {
  trigger: Trigger;
  /** "main", or the sub-agent's type. */
  label: string;
  limit: number;
  /** The party's current context tokens; undefined when no reading could be taken. */
  tokens: number | undefined;
};

export type Decision =
  | { action: 'pass'; why: 'requested' | 'at-limit' | 'no-reading' }
  | { action: 'skip'; reason: string };

/**
 * One compaction request: a person's or plugin's always passes; an automatic
 * one is held while the party is below its limit. No reading never holds.
 */
export function decide({ trigger, label, limit, tokens }: DecideInput): Decision {
  if (trigger === 'manual' || trigger === 'plugin') return { action: 'pass', why: 'requested' };
  if (tokens === undefined || !Number.isFinite(tokens)) return { action: 'pass', why: 'no-reading' };
  if (tokens >= limit) return { action: 'pass', why: 'at-limit' };
  return { action: 'skip', reason: `sub-agent-compact: ${label} held below ${limit} (now ${tokens})` };
}

/** The context a response was answered over: uncached input plus cache reads and writes. */
export function contextTokens(usage: {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
} | null | undefined): number | undefined {
  if (!usage || typeof usage.input_tokens !== 'number') return undefined;
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

type TranscriptMessage = {
  text?: string;
  toolUses?: readonly { tool_use_id: string; input?: unknown; text?: string }[];
  toolResults?: readonly { tool_use_id: string; text?: string }[];
};

/** Characters per token for the estimate; code runs near 3.5. */
const CHARS_PER_TOKEN = 3.5;

/**
 * A rough token count of a transcript in `session.compact`'s shape: message
 * text, tool inputs and each tool result once (a result the transcript
 * carries both on the call and on the answer is counted once). It leaves out
 * the system prompt and tool definitions, so it runs below the true context.
 */
export function estimateTranscript(messages: readonly TranscriptMessage[]): number {
  let chars = 0;
  const answered = new Set<string>();
  for (const message of messages) for (const result of message.toolResults ?? []) answered.add(result.tool_use_id);
  for (const message of messages) {
    chars += message.text?.length ?? 0;
    for (const use of message.toolUses ?? []) {
      chars += JSON.stringify(use.input ?? {}).length;
      if (!answered.has(use.tool_use_id)) chars += use.text?.length ?? 0;
    }
    for (const result of message.toolResults ?? []) chars += result.text?.length ?? 0;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * A party's context now. The last response's usage lags by one step: the
 * tool results that came back since are not in it, and one step of parallel
 * reads can add 100k tokens. The transcript estimate sees them, so the larger
 * of the two is taken; no usage reading at all gives undefined.
 */
export function currentTokens(lastResponse: number | undefined, messages: readonly TranscriptMessage[]): number | undefined {
  if (lastResponse === undefined) return undefined;
  return Math.max(lastResponse, estimateTranscript(messages));
}
