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

/**
 * A model's context window. The plugin API reports the main chat's window
 * only, so a sub-agent's comes from its model id: Haiku 200k, a `[1m]` id and
 * Sonnet 5 1M (the windows Claude Code 2.1.282 reported in `modelUsage`).
 * Any other model gets `fallback`, the main chat's window.
 */
export function modelWindow(model: string | undefined, fallback: number): number {
  if (model === undefined) return fallback;
  if (isHaiku(model)) return 200_000;
  if (/\[1m\]/i.test(model) || /^claude-sonnet-5/i.test(model)) return 1_000_000;
  return fallback;
}
