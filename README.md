# sub-agent-compact

A Claude Code plugin that gives the main chat and each sub-agent their own
compaction policy. As a party's context grows, its model is nudged to reach
a milestone and compact itself, and it chooses the moment and what the
summary keeps. Each party also has a forced point where it compacts whether
it asked or not. A reader sub-agent can run to 300k tokens, a quick lookup
agent can compact at 80k, and the main chat can hold out until 600k. Claude
Code on its own gives them all the same point.

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
- An automatic compaction (`auto` or `precompute`) passes once the party's
  model has asked to compact itself (see Self-compaction). The model's focus
  becomes what the summarizer is told.
- A party with automatic compaction off (`autoCompactEnabled: false`) has
  every other automatic compaction held.
- Otherwise an automatic compaction is held while that party's context is
  below its forced point (`autoCompact`). It passes once the context reaches
  that point.
- The main chat's context comes from `$.session.usage()`. A sub-agent's
  context comes from its own model responses: `turn.step` usage, where input,
  cache-read and cache-creation tokens are summed. That usage lags one step
  behind, because it misses the tool results that arrived since. So the
  plugin also estimates the transcript it was handed (about 3.5 characters a
  token) and uses whichever figure is larger, so the lag never holds a
  party that is already past its limit.
- The check runs once per model request, so a party can pass its limit by
  up to one step of tool output before it is asked. In a live run of four
  executors limited to 100k, compactions landed between 100k and 177k, the
  high ones right after a step that read several whole files at once. Where
  a limit is tight, have the agent read in smaller batches.
- When the main chat's limit is below Claude Code's window, the plugin
  compacts the main chat itself between turns, once it reaches the limit.
  Claude Code 2.1.283 has no between-turn compaction in a headless (`-p`)
  session. There the call fails, is logged, and the turn carries on.

If a lookup fails (usage, agent list, a definition file), the plugin logs it
and lets the compaction through. It never holds a compaction because of an
error.

## Self-compaction

The model knows when it has finished a unit of work, and a token count
doesn't. So the plugin tells each model how full it is and lets it choose
the moment.

- **Nudges.** After a tool call, once a party's context passes its
  `autoCompactNudgeStart`, the model reads a line after the tool's result. The
  line gives its size, the forced point, and how to compact itself. One more
  line follows at each `autoCompactNudgeEvery` step past the start. The
  nudges start over after each compaction.
- **Asking.** The main chat calls the `compact` tool
  (`mcp__sub-agent-compact__compact`) with a `focus`: the plan or its file,
  what is done, what is left, the next step. A sub-agent whose definition has
  a `tools:` allowlist never sees a plugin's tool (checked on 2.1.283). So a
  sub-agent can also write `<compact-now>its focus</compact-now>` in a
  response that also calls a tool. A marker in a final answer, a marker
  quoted in backticks, and a marker in the main chat's text don't count.
  A sub-agent that sends the marker alone would end its run, because a
  response without a tool call is its final answer. So the plugin refuses
  that stop once (`classic.SubagentStop`), and the agent carries on and
  compacts on its next request.
- **Running.** The request arms the party. The next time Claude Code asks
  to compact it, the plugin lets the compaction through with the focus as
  the summarizer's instructions. Claude Code asks before each model request
  once the party passes its ask point (see The window rule). A request made
  below that point waits for it. For the main chat, it runs when the turn
  ends instead.
- **Haiku** is left alone: no nudges and no self-compaction. It compacts
  at Claude Code's own point for its 200k window, 167k.

Percentages are of the model's own window. For the main chat that's
`$.session.usage()`'s window. A sub-agent's window comes from its model id:
Haiku 200k, a `[1m]` id and Sonnet 5 1M, and any other model gets the main
chat's window.

In a live run, one Sonnet 5 sub-agent read twelve 8k-token files, nudged
from 15k. It compacted itself three times, each within a step of being
asked, from about 65k down to 12k, and every answer it returned was
correct.

On a larger job, one Sonnet 5 executor renamed an identifier in 24 Go files,
Edit only, about 500 requests:

| Run | Cost | Executor time | Compactions | Exact files |
| --- | --- | --- | --- | --- |
| No compaction | $18.39 | 29 min | 0 | 24/24 |
| Blind 100k forced point | $12.25 | 81 min | 6 | 24/24 |
| Self-compaction, these defaults | $12.20 | 47 min | 4, each at a milestone the model picked | 23/24 |

That run also found a bug, fixed since: a stale reading right after a
compaction used up a nudge, so one stretch ran to 205k before the next.

## The window rule

The plugin can hold a compaction back, but it can't make Claude Code ask
sooner. A plugin can start a compaction only for the main chat, between
turns. Claude Code asks to compact a sub-agent only once that sub-agent
nears `CLAUDE_CODE_AUTO_COMPACT_WINDOW`: about 33k below it, measured as
about 65k with `100000` on 2.1.283. That is a launch environment variable,
and a plugin can't set it. So:

**Set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` so Claude Code asks at or below your
smallest sub-agent limit and nudge start.** `100000` asks from about 65k.
The plugin then holds every party until its own point, or until its model
asks. The request to let a plugin compact any loop from code is
[anthropics/claude-code#91870](https://github.com/anthropics/claude-code/issues/91870#issuecomment-5848066352).

The plugin logs a line once per agent type when that type's forced point is
below Claude Code's ask point. If the window is unset, it logs a line once
per party the first time it is asked to compact well past that party's
forced point.

## Install

Function hooks must be enabled. You can export the variable in your shell,
or set it in the `env` block of `settings.json`. Both work (tested on
2.1.282).

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000   # Claude Code asks from about 65k

claude plugin marketplace add rezzminator/sub-agent-compact
claude plugin install sub-agent-compact@sub-agent-compact
```

To develop locally: `claude --plugin-dir /path/to/sub-agent-compact`.

## Options

Set these through `/config`, or under
`pluginConfigs["sub-agent-compact@sub-agent-compact"].options` in
`settings.json`. The key is the full plugin id, `{plugin}@{marketplace}`:
Claude Code accepts a bare plugin name only for plugins from its official
marketplace, and silently ignores options under any other key, so the plugin
runs on its defaults. A size is
a percentage of the model's window (`"30%"`), an integer, or a number with a
k/m suffix (`"150k"`, `"0.6m"`). A bad value is logged by name and replaced
by the default. It is never ignored silently.

| Option | Default | Meaning |
| --- | --- | --- |
| `mainAutoCompact` | `60%` | The main chat's forced point. |
| `mainAutoCompactNudgeStart` | `20%` | Where the main chat is first nudged to compact itself. |
| `mainAutoCompactNudgeEvery` | `10%` | The step between the main chat's nudges. |
| `mainAutoCompactEnabled` | `true` | Off: the main chat is never nudged or compacted automatically. Its own request still runs. |
| `subagentAutoCompact` | `30%` | The forced point of a sub-agent whose definition doesn't set its own. This covers built-ins such as `general-purpose` and `Explore`. |
| `subagentAutoCompactNudgeStart` | `10%` | A sub-agent's first nudge. |
| `subagentAutoCompactNudgeEvery` | `10%` | The step between a sub-agent's nudges. |
| `subagentAutoCompactEnabled` | `true` | Off: sub-agents are never nudged or compacted automatically. Their own requests still run. |
| `agentDirs` | empty | Comma-separated extra directories of agent definitions. |
| `logFile` | empty | Absolute path of the JSONL decision log. Each session writes its own file, with the session id before the extension: `decisions.jsonl` gives `decisions.{session-id}.jsonl`. A resumed session appends to its file. |

```json
{
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" },
  "pluginConfigs": {
    "sub-agent-compact@sub-agent-compact": {
      "options": { "mainAutoCompact": "400k", "subagentAutoCompact": "30%", "subagentAutoCompactNudgeStart": "10%" }
    }
  }
}
```

## Per-agent policy

To give one agent its own policy, set any of these keys in its definition's
frontmatter. Each overrides the `subagent*` option of the same name, and a
key left out keeps that option's value:

```markdown
---
name: big-reader
description: Reads large files in full.
autoCompact: 200k
autoCompactNudgeStart: 15%
autoCompactNudgeEvery: 5%
autoCompactEnabled: true
---
You read files...
```

`autoCompactEnabled: false` suits an agent whose context must stay verbatim,
because it is never nudged or compacted automatically. Past its window it
fails the way Claude Code does with auto-compact off.

The plugin gets a sub-agent's type from `$.agent.list()` (for example
`big-reader`). It then looks for the definition in this order:

1. `<cwd>/.claude/agents/<type>.md`
2. `~/.claude/agents/<type>.md`
3. each `agentDirs` entry

If the filename differs from the type, it falls back to a file whose
frontmatter `name:` matches. A type with no definition file gets the
`subagent*` options. Results are cached per agent.

## Development

```sh
npm install
npm test              # unit tests for src/
npm run typecheck
claude plugin validate .claude-plugin/plugin.json
```

`hooks/sub-agent-compact.ts` is a thin adapter over `src/`:

- `limits.ts`: parses sizes and options into a policy per party.
- `frontmatter.ts`: reads agent frontmatter.
- `agents.ts`: resolves an agent type to its policy.
- `window.ts`: model windows and Claude Code's ask point.
- `nudge.ts`: nudge levels and text, the `<compact-now>` marker, the compact tool's reply.
- `parties.ts`: per-party state: readings, the armed focus, nudges sent, a refused stop.
- `decide.ts`: makes the decision.

## License

MIT
