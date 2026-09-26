/** Past `start`, one level per `every` tokens; -1 below `start`. */
export function nudgeLevel(tokens: number, start: number, every: number): number {
  if (tokens < start) return -1;
  return Math.floor((tokens - start) / Math.max(1, every));
}

const MARKER = /(?<!`)<compact-now>([\s\S]*?)<\/compact-now>(?!`)/;

/**
 * The focus a model wrote between `<compact-now>` tags in its visible text:
 * the self-compact request of an agent whose tool allowlist leaves out the
 * compact tool. Undefined without the tags, with an empty focus, or for a
 * marker quoted in backticks.
 */
export function compactMarker(answer: string): string | undefined {
  const focus = MARKER.exec(answer)?.[1]?.trim();
  return focus ? focus : undefined;
}

/**
 * The focus of a sub-agent's marker request. Only a response that also calls
 * a tool counts: a final answer that describes the marker ends the agent and
 * arms nothing. The main chat asks through the compact tool, and its text may
 * relay a sub-agent's answer, so its markers never count.
 */
export function markerRequest({ answer, toolCalls, main }: { answer: string; toolCalls: number; main: boolean }): string | undefined {
  if (main || toolCalls === 0) return undefined;
  return compactMarker(answer);
}

/**
 * The focus of a sub-agent that stopped on a marker: a response without a
 * tool call ends a sub-agent's run, so a model that sends the marker alone
 * would end its task. The stop is refused once per armed request, so the
 * agent continues and compacts on its next request.
 */
export function stopRequest({ lastMessage, continued }: { lastMessage: string | undefined; continued: boolean }): string | undefined {
  if (continued || lastMessage === undefined) return undefined;
  return compactMarker(lastMessage);
}

/** The block reason a sub-agent reads when its stop on a marker is refused. */
export const CONTINUE_AFTER_MARKER =
  'sub-agent-compact: compaction armed with your focus. You are not done: your task continues. Your next model request compacts you first; then carry on from the next step your focus named.';

function k(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

export type NudgeInput = {
  tokens: number;
  window: number;
  /** 0 for the first nudge. */
  level: number;
  /** The forced point, in tokens. */
  autoCompact: number;
  main: boolean;
  /** The compact tool's full name. */
  toolName: string;
};

/** What the model reads after a tool result once its context passes a nudge point. */
export function nudgeText({ tokens, window, level, autoCompact, main, toolName }: NudgeInput): string {
  const how = main
    ? `call ${toolName} with a focus`
    : `call ${toolName} with a focus if you have that tool; otherwise write <compact-now>your focus</compact-now> in a response that also makes your next tool call, never alone, because a response without a tool call ends your run`;
  return [
    `sub-agent-compact: your context is ${k(tokens)} tokens (${Math.round((tokens / window) * 100)}% of your ${k(window)} window).`,
    'If you are on your last job (one task or your final answer left), finish it first and do not compact.',
    level > 0 ? `Nudge ${level + 1}: with more work still ahead, compact at your very next milestone.` : 'With more work still ahead, wrap up the step in hand and get ready to compact.',
    'At a clean milestone, write anything you must not lose to a file, then compact yourself:',
    `${how}.`,
    'The summary keeps what the focus names, so name the plan or its file, what is done, what is left and the next step.',
    `Compaction is forced at ${k(autoCompact)} whether you ask or not.`,
  ].join(' ');
}

/** The compact tool's reply: when the compaction the model asked for will run. */
export function armedText({ main, tokens, askPoint }: { main: boolean; tokens: number | undefined; askPoint: number | undefined }): string {
  const lead = 'Compaction armed with your focus.';
  if (askPoint !== undefined && tokens !== undefined && tokens >= askPoint) return `${lead} It runs before your next model request; carry on with the next step.`;
  if (main) return `${lead} It runs when this turn ends; carry on or end the turn.`;
  if (askPoint === undefined) return `${lead} It runs when Claude Code next asks to compact you, near your window; carry on.`;
  return `${lead} It runs once your context reaches ${k(askPoint)}, where Claude Code starts asking; below that a compaction costs more than it saves. Carry on.`;
}
