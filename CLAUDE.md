# sub-agent-compact

A Claude Code function-hooks plugin: per-party compaction policy, nudges, and
self-compaction at a milestone the model picks. `README.md` is the
behavioural spec.

## Layout

- `plugins/sub-agent-compact/`: everything that installs, and nothing else — the directory scans only this folder, so dev files never go in it.
- `plugins/sub-agent-compact/hooks/sub-agent-compact.ts`: the adapter, the only file that touches `$`.
- `plugins/sub-agent-compact/src/`: every decision, pure and unit-tested; `tests/` holds one vitest file per concern.
- `types/claude-code.d.ts`: the plugin API (from `/plugin-types`), the truth for every hook's shape; grep it before using an event.
- `plugins/sub-agent-compact/.claude-plugin/`: `plugin.json` (manifest, `userConfig` defaults) and `icon.svg`; the root `.claude-plugin/marketplace.json` makes the repo its own marketplace, with `source: ./plugins/sub-agent-compact`.

## Commands

`npm test`, `npm run typecheck` and `npm run validate:plugin` all pass before a commit. A live check loads the checkout with `--plugin-dir plugins/sub-agent-compact`: its options key is then `sub-agent-compact@inline`, and the installed copy is disabled in the same `--settings`.

## Rules

- A new behaviour lands in `plugins/sub-agent-compact/src/` as a pure function with a test watched failing first; the adapter only wires it.
- An error never holds a compaction: log it with context, let the compaction pass.
- A bad option is logged by name and falls back to its default.
- A version bump moves `plugins/sub-agent-compact/.claude-plugin/plugin.json`, `marketplace.json`, `package.json` and the README badge together; installed copies update only on a new version.
- Defaults agree in three places: `plugins/sub-agent-compact/src/limits.ts` (`DEFAULT_MAIN`, `DEFAULT_SUBAGENT`), `plugin.json`'s `userConfig`, and the README options table.
- The README benchmark reports measured runs only; a figure the code has changed since is labelled not re-measured.
- Public repo: no machine-absolute paths, personal data or private project names in a tracked file.
- Publishing: README and marketing changes are pushed as soon as they are committed; code is pushed only when the owner asks.
- `$` is passed only to functions declared at the top level of the hooks file and always spelled `$.noun.event(...)`: Claude Code checks this statically and otherwise loads the module with zero hooks. `npm run validate:plugin` catches it.
