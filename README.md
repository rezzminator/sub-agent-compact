# sub-agent-compact

A Claude Code plugin that gives the main chat and each sub-agent their own
auto-compact point. A reader sub-agent can run to 130k tokens, a quick
lookup agent can compact at 80k, and the main chat can hold out until 600k.
Claude Code on its own gives them all the same point.

> **Early access.** This plugin is built on Claude Code's function hooks,
> which are an early-access surface that may change between releases. The
> bundled `types/claude-code.d.ts` was written by Claude Code 2.1.282's
> `/plugin-types`.

## Why

Claude Code compacts every conversation at one point: the auto-compact
window. That window belongs to the whole process
([anthropics/claude-code#90347](https://github.com/anthropics/claude-code/issues/90347)),
so the main chat and every sub-agent it spawns compact at the same token count.
The classic `PreCompact` hook can't separate them either, because its input
carries no `agent_id`
([anthropics/claude-code#91910](https://github.com/anthropics/claude-code/issues/91910)).

Function hooks can. The `session.compact` event carries `agentId` when a
sub-agent's own transcript is compacting, and leaves it out for the main
conversation. Answering `{ skip }` vetoes one automatic compaction. The veto
costs nothing, because Claude Code asks again before its next model request.
This plugin decides per party:

- A person's `/compact` and a plugin's compaction always pass.
- An automatic compaction (`auto` or `precompute`) is held while that
  party's context is below its limit. It passes once the context reaches the
  limit.
- The main chat's context comes from `$.session.usage()`. A sub-agent's
  context comes from its own model responses: `turn.step` usage, where input,
  cache-read and cache-creation tokens are summed. That usage lags one step
  behind, because it misses the tool results that arrived since. So the
  plugin also estimates the transcript it was handed (about 3.5 characters a
  token) and uses whichever figure is larger. A batch of parallel reads
  therefore can't slip past a limit.
- When the main chat's limit is below Claude Code's window, the plugin
  compacts the main chat itself between turns, once it reaches the limit.

If a lookup fails (usage, agent list, a definition file), the plugin logs it
and lets the compaction through. It never holds a compaction because of an
error.

## The window rule

The plugin can hold a compaction back, but it can't make Claude Code ask
sooner. Claude Code only asks to compact a sub-agent once that sub-agent
reaches its native window, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. That is a
launch environment variable, and a plugin can't set it. So:

**Set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to your smallest sub-agent limit.**
The plugin then holds every party that has a higher limit until it reaches
that limit.

The plugin logs a line once per agent type when that type's limit is below
the window. If the window is unset, it logs a line once per party the first
time it is asked to compact well past that party's limit.

## Install

Function hooks must be enabled. You can export the variable in your shell,
or set it in the `env` block of `settings.json`. Both work (tested on
2.1.282).

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000   # your smallest sub-agent limit

claude plugin marketplace add rezzminator/sub-agent-compact
claude plugin install sub-agent-compact@sub-agent-compact
```

To develop locally: `claude --plugin-dir /path/to/sub-agent-compact`.

## Options

Set these through `/config`, or under
`pluginConfigs["sub-agent-compact"].options` in `settings.json`. A limit is
an integer or a number with a k/m suffix (`"150k"`, `"0.6m"`). A bad value is
logged by name and replaced by the default. It is never ignored silently.

| Option | Default | Meaning |
| --- | --- | --- |
| `mainAutoCompact` | `600000` | Context tokens at which the main chat compacts. |
| `subagentAutoCompact` | `150000` | Context tokens for a sub-agent whose definition has no `autoCompact`. This covers built-ins such as `general-purpose` and `Explore`. |
| `agentDirs` | empty | Comma-separated extra directories of agent definitions. |
| `logFile` | empty | Absolute path of a JSONL log with one row per decision. |

```json
{
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" },
  "pluginConfigs": {
    "sub-agent-compact": {
      "options": { "mainAutoCompact": "400k", "subagentAutoCompact": "100k" }
    }
  }
}
```

## Per-agent limits

To give one agent its own limit, add `autoCompact` to its definition's
frontmatter:

```markdown
---
name: big-reader
description: Reads large files in full.
autoCompact: 200k
---
You read files...
```

The plugin gets a sub-agent's type from `$.agent.list()` (for example
`big-reader`). It then looks for the definition in this order:

1. `<cwd>/.claude/agents/<type>.md`
2. `~/.claude/agents/<type>.md`
3. each `agentDirs` entry

If the filename differs from the type, it falls back to a file whose
frontmatter `name:` matches. A type with no definition file gets
`subagentAutoCompact`. Results are cached per agent.

## Development

```sh
npm install
npm test              # unit tests for the decision logic in src/
npm run typecheck
claude plugin validate .claude-plugin/plugin.json
```

`hooks/sub-agent-compact.ts` is a thin adapter over `src/`:

- `limits.ts`: parses the options.
- `frontmatter.ts`: reads agent frontmatter.
- `agents.ts`: resolves an agent type to its limit.
- `decide.ts`: makes the decision.

## License

MIT
