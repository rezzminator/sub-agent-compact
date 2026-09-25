/** Built-in defaults, in tokens. */
export const DEFAULT_MAIN_AUTO_COMPACT = 600_000;
export const DEFAULT_SUBAGENT_AUTO_COMPACT = 150_000;

export type LimitParse = { ok: true; value: number } | { ok: false; error: string };

const LIMIT = /^(\d+(?:\.\d+)?|\.\d+)\s*([km])?$/i;

/**
 * Parses a token limit: a positive integer, or a number with a k/m suffix
 * ("150k", "0.6m"). Anything else is an error naming the value.
 */
export function parseLimit(raw: unknown): LimitParse {
  if (typeof raw === 'number') {
    if (Number.isFinite(raw) && raw > 0) return { ok: true, value: Math.round(raw) };
    return { ok: false, error: `not a positive number: ${raw}` };
  }
  if (typeof raw !== 'string') return { ok: false, error: `not a number or string: ${JSON.stringify(raw)}` };
  const match = LIMIT.exec(raw.trim().replace(/_/g, ''));
  if (!match) return { ok: false, error: `not an integer or a k/m value: ${JSON.stringify(raw)}` };
  const scale = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2] ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * scale);
  if (!(value > 0)) return { ok: false, error: `not positive: ${JSON.stringify(raw)}` };
  return { ok: true, value };
}

export type ResolvedOptions = {
  mainAutoCompact: number;
  subagentAutoCompact: number;
  agentDirs: string[];
  logFile?: string;
  /** One line per option that was invalid and fell back; empty when all were valid. */
  errors: string[];
};

function limitOption(options: Record<string, unknown>, key: string, fallback: number, errors: string[]): number {
  const raw = options[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseLimit(raw);
  if (parsed.ok) return parsed.value;
  errors.push(`sub-agent-compact: option ${key} is invalid (${parsed.error}); using the default ${fallback}`);
  return fallback;
}

function dirList(raw: unknown, errors: string[]): string[] {
  if (raw === undefined || raw === '') return [];
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : null;
  if (!items) {
    errors.push(`sub-agent-compact: option agentDirs is invalid (not a string or list: ${JSON.stringify(raw)}); ignoring it`);
    return [];
  }
  return items.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

/** Validates the plugin options; every invalid value falls back and is named in `errors`. */
export function resolveOptions(options: Record<string, unknown>): ResolvedOptions {
  const errors: string[] = [];
  const mainAutoCompact = limitOption(options, 'mainAutoCompact', DEFAULT_MAIN_AUTO_COMPACT, errors);
  const subagentAutoCompact = limitOption(options, 'subagentAutoCompact', DEFAULT_SUBAGENT_AUTO_COMPACT, errors);
  const agentDirs = dirList(options.agentDirs, errors);
  let logFile: string | undefined;
  const rawLog = options.logFile;
  if (typeof rawLog === 'string' && rawLog.trim() !== '') {
    if (rawLog.trim().startsWith('/')) logFile = rawLog.trim();
    else errors.push(`sub-agent-compact: option logFile must be an absolute path (got ${JSON.stringify(rawLog)}); logging off`);
  }
  return { mainAutoCompact, subagentAutoCompact, agentDirs, ...(logFile ? { logFile } : {}), errors };
}
