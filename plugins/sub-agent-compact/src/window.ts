/**
 * What Claude Code keeps free below a window before it asks to compact: the
 * 13k auto-compact margin plus the 20k reserved for the summary's output.
 * The native ask point of a 1M window is therefore 967k, and of 200k, 167k.
 */
export const ENGINE_COMPACT_BUFFER = 33_000;

/** The context at which Claude Code asks to compact a loop, given the window it compacts against. */
export function engineAskPoint(window: number): number {
  return Math.max(0, window - ENGINE_COMPACT_BUFFER);
}

export function isHaiku(model: string | undefined): boolean {
  return model !== undefined && /haiku/i.test(model);
}

/** The window Claude Code gives a model id it does not know, and enforces on its requests. */
export const ENGINE_DEFAULT_WINDOW = 200_000;

/** A Claude model: a Claude id in any provider's spelling, or a bare Claude Code alias. */
export function isClaude(model: string): boolean {
  return /claude/i.test(model) || /^(opus|sonnet|haiku|fable|default|best)(\[1m\])?$/i.test(model);
}

/**
 * A model's context window. The plugin API reports the main chat's window
 * only, so a sub-agent's comes from its model id: Haiku 200k, a `[1m]` id and
 * Sonnet 5 1M (the windows Claude Code 2.1.282 reported in `modelUsage`).
 * A model that is not Claude, such as a GPT model behind a gateway, gets
 * Claude Code's 200k default: the client refuses a request past it as
 * "Prompt is too long", whatever the model upstream holds.
 * Any other Claude model gets `fallback`, the main chat's window.
 */
export function modelWindow(model: string | undefined, fallback: number): number {
  if (model === undefined) return fallback;
  if (isHaiku(model)) return 200_000;
  if (/\[1m\]/i.test(model) || /^claude-sonnet-5/i.test(model)) return 1_000_000;
  if (!isClaude(model)) return ENGINE_DEFAULT_WINDOW;
  return fallback;
}
