import type { EngineInterface, On, PluginOptions, Register } from 'claude-code';
import { AgentLimits } from '../src/agents.ts';
import { contextTokens, currentTokens, decide } from '../src/decide.ts';
import { resolveOptions, type ResolvedOptions } from '../src/limits.ts';
import { appendRows, sessionLogPath } from '../src/log.ts';

// Thin adapter: every decision lives in src/. Each hook catches its own
// failures, logs them with context and lets the compaction through.

const LOG_CAP = 2000;

type Row = Record<string, unknown>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type State = {
  config: ResolvedOptions;
  started?: Promise<void>;
  limits?: AgentLimits;
  nativeWindow?: number;
  typeById: Map<string, string>;
  readings: Map<string, number>;
  asked: Set<string>;
  warned: Set<string>;
  pending: string[];
  logPath?: Promise<string | undefined>;
  writing: Promise<void>;
  mainCompactedThisTurn: boolean;
  mainCompacting: boolean;
};

// Rows queue in memory; each flush reads the session's file and appends them,
// so a resumed session keeps its earlier rows and no other chat shares the file.
function record(st: State, $: EngineInterface, row: Row): void {
  const file = st.config.logFile;
  if (!file) return;
  st.pending.push(JSON.stringify({ ts: new Date().toISOString(), ...row }));
  st.logPath ??= $.session.id().then(
    (id) => sessionLogPath(file, id),
    (error) => {
      $.ui.log(`sub-agent-compact: reading the session id failed: ${message(error)}; the decision log is off for this session`);
      return undefined;
    },
  );
  st.writing = st.writing
    .then(async () => {
      const path = await st.logPath;
      const rows = st.pending.splice(0);
      if (!path || rows.length === 0) return;
      const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : '';
      await $.fs.write(path, appendRows(existing, rows, LOG_CAP));
    })
    .catch((error) => $.ui.log(`sub-agent-compact: writing the decision log for ${file} failed: ${message(error)}`));
}

function warnOnce(st: State, $: EngineInterface, key: string, line: string): void {
  if (st.warned.has(key)) return;
  st.warned.add(key);
  $.ui.log(line);
  record(st, $, { event: 'warning', key, line });
}

// First hook call: report option errors, learn the native window, build the resolver.
function start(st: State, $: EngineInterface): Promise<void> {
  st.started ??= (async () => {
    for (const line of st.config.errors) {
      $.ui.log(line);
      record(st, $, { event: 'option-error', line });
    }
    let cwd = '.';
    let home: string | undefined;
    try {
      cwd = await $.session.cwd();
    } catch (error) {
      $.ui.log(`sub-agent-compact: reading the session cwd failed: ${message(error)}; using relative paths`);
    }
    try {
      home = await $.env.get('HOME');
    } catch (error) {
      $.ui.log(`sub-agent-compact: reading HOME failed: ${message(error)}; skipping ~/.claude/agents`);
    }
    try {
      const raw = await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW');
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) st.nativeWindow = parsed;
    } catch (error) {
      $.ui.log(`sub-agent-compact: reading CLAUDE_CODE_AUTO_COMPACT_WINDOW failed: ${message(error)}`);
    }
    const dirs = [`${cwd}/.claude/agents`, ...(home ? [`${home}/.claude/agents`] : []), ...st.config.agentDirs];
    st.limits = new AgentLimits(
      dirs,
      st.config.subagentAutoCompact,
      {
        exists: (path) => $.fs.exists(path),
        read: (path) => $.fs.read(path),
        listMarkdown: async (dir) =>
          (await $.fs.list(dir)).filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md')).map((entry) => entry.name),
      },
      (line) => {
        $.ui.log(line);
        record(st, $, { event: 'resolve-error', line });
      },
    );
    record(st, $, { event: 'start', mainAutoCompact: st.config.mainAutoCompact, subagentAutoCompact: st.config.subagentAutoCompact, agentDirs: dirs, nativeWindow: st.nativeWindow ?? null });
  })();
  return st.started;
}

async function agentType(st: State, $: EngineInterface, agentId: string): Promise<string> {
  const known = st.typeById.get(agentId);
  if (known) return known;
  const agent = (await $.agent.list()).find((info) => info.id === agentId);
  if (!agent) throw new Error(`agent ${agentId} is not in $.agent.list()`);
  st.typeById.set(agentId, agent.type);
  return agent.type;
}

export const register: Register = (on: On, options: PluginOptions) => {
  const st: State = {
    config: resolveOptions(options as Record<string, unknown>),
    typeById: new Map(),
    readings: new Map(),
    asked: new Set(),
    warned: new Set(),
    pending: [],
    writing: Promise.resolve(),
    mainCompactedThisTurn: false,
    mainCompacting: false,
  };

  // Track each loop's context from its responses' usage.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e);
    try {
      const tokens = contextTokens(result.usage);
      if (tokens !== undefined) st.readings.set(e.agentId ?? 'main', tokens);
    } catch (error) {
      $.ui.log(`sub-agent-compact: reading turn.step usage failed: ${message(error)}`);
    }
    return result;
  });

  on('session.compact', async ($, e, next) => {
    const agentId = e.agentId;
    const base: Row = { event: 'session.compact', trigger: e.trigger, party: agentId ? 'sub' : 'main', agentId: agentId ?? null };
    let label = 'main';
    let limit = st.config.mainAutoCompact;
    let source = 'mainAutoCompact';
    let tokens: number | undefined;
    try {
      await start(st, $);
      if (agentId) {
        label = await agentType(st, $, agentId);
        const resolved = await st.limits!.resolve(label);
        limit = resolved.limit;
        source = resolved.source === 'default' ? 'subagentAutoCompact' : resolved.source;
        tokens = currentTokens(st.readings.get(agentId), e.messages);
        if (st.nativeWindow !== undefined && limit < st.nativeWindow) {
          warnOnce(st, $, `below-window:${label}`, `sub-agent-compact: ${label} limit ${limit} is below CLAUDE_CODE_AUTO_COMPACT_WINDOW ${st.nativeWindow}; Claude Code will not ask to compact it before ${st.nativeWindow} — set the window to your smallest sub-agent limit`);
        }
      } else {
        tokens = currentTokens((await $.session.usage()).context.tokens, e.messages);
      }
    } catch (error) {
      const line = `sub-agent-compact: deciding ${agentId ? `sub-agent ${agentId}` : 'main'} ${e.trigger} compaction failed: ${message(error)}; letting it through`;
      $.ui.log(line);
      record(st, $, { ...base, type: label, decision: 'pass', why: 'error', error: message(error) });
      return next(e);
    }
    const decision = decide({ trigger: e.trigger, label, limit, tokens });
    const lastResponse = agentId ? st.readings.get(agentId) : st.readings.get('main');
    record(st, $, { ...base, type: label, limit, source, tokens: tokens ?? null, lastResponseTokens: lastResponse ?? null, messages: e.messages.length, decision: decision.action, ...(decision.action === 'pass' ? { why: decision.why } : {}) });
    if (decision.action === 'skip') {
      if (e.trigger === 'auto') st.asked.add(agentId ?? 'main');
      return { skip: decision.reason };
    }
    if (decision.why === 'no-reading') $.ui.log(`sub-agent-compact: no token reading for ${label}; letting the ${e.trigger} compaction through`);
    const firstAsk = !st.asked.has(agentId ?? 'main');
    if (e.trigger === 'auto') st.asked.add(agentId ?? 'main');
    // With the window known, a first ask past the limit is one step's growth, not a window set too high.
    if (e.trigger === 'auto' && firstAsk && st.nativeWindow === undefined && tokens !== undefined && tokens > limit * 1.1) {
      warnOnce(st, $, `late:${label}`, `sub-agent-compact: ${label} was first asked to compact at ${tokens}, past its limit ${limit}; CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset, so Claude Code's native window is likely above this limit — set it to your smallest sub-agent limit`);
    }
    if (!agentId) st.mainCompactedThisTurn = true;
    return next(e);
  });

  // Main earlier than the native window: compact between turns once past mainAutoCompact.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;
    if (st.mainCompactedThisTurn) {
      st.mainCompactedThisTurn = false;
      return result;
    }
    if (st.mainCompacting) return result;
    try {
      await start(st, $);
      const tokens = (await $.session.usage()).context.tokens;
      if (tokens === undefined || tokens < st.config.mainAutoCompact) return result;
      st.mainCompacting = true;
      record(st, $, { event: 'turn.complete', party: 'main', tokens, limit: st.config.mainAutoCompact, action: 'compact' });
      const outcome = await $.session.compact();
      record(st, $, { event: 'turn.complete.compacted', party: 'main', skipped: 'skip' in outcome && outcome.skip ? outcome.skip : null });
    } catch (error) {
      $.ui.log(`sub-agent-compact: early main compaction failed: ${message(error)}`);
      record(st, $, { event: 'turn.complete', party: 'main', error: message(error) });
    } finally {
      st.mainCompacting = false;
      st.mainCompactedThisTurn = false;
    }
    return result;
  });
};
