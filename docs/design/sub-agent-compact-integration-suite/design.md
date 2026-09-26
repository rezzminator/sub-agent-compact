# sub-agent-compact integration suite

The test suite design for the `sub-agent-compact` Claude Code plugin: the three tiers, the capability landscape, the lanes the live tier runs, and the checks that keep the suite honest. The owner ruled the tiers, the fence, live isolation, the goldens, Law 5 and the numbers (`references.tsv` rows `brief-*`). The items the owner has not ruled are listed with recommendations in section 15.

The ledgers beside this file are `landscape.md`, `beats.md`, `map.tsv`, `pending.txt`, `retired.tsv`, `references.tsv`, `roster.txt`, `skip-reasons.txt`, `unobservable.txt`, `self-tests.txt`, `exclusions.txt`, `ruled-copy.tsv`, `gaps.tsv`, `flakes.tsv`, `bites.tsv`, `budgets.tsv` and `runs/`. The checks live at the repository root in `scripts/suite-checks.sh` and `scripts/suite-checks/`.

The product is one TypeScript function-hook module. Claude Code loads `plugins/sub-agent-compact/hooks/sub-agent-compact.ts` verbatim, as named by `plugins/sub-agent-compact/hooks/hooks.json` and `plugins/sub-agent-compact/.claude-plugin/plugin.json`; there is no build step. The module:

- registers three handlers: `turn.step`, `session.compact` and `turn.complete`;
- reads its options from the engine;
- writes one JSON-lines decision log per session;
- reaches the outside world only through the engine interface `$`, except for one clock read.

## 1. Tiers

The owner ruled this section (`brief-tiers`, `brief-fence`, `brief-live-isolation`, `brief-law5`).

### Unit

**What it asserts.** Every decision, option parse, frontmatter read, log path and row cap in `plugins/sub-agent-compact/src/`. It also covers the hook glue in `plugins/sub-agent-compact/hooks/sub-agent-compact.ts` (`register`, the three handlers, `start`, `record`, `warnOnce`). The glue runs in-process against the scripted engine interface from the fakes directory. These are the 48 existing vitest tests, kept and retitled (section 3), plus the rows `beats.md` adds.

**What it fakes.** Two things:
- the engine interface `$` (`tests/fakes/engine.ts`);
- the agent filesystem (`tests/fakes/memory-agent-fs.ts`).

**Gate.** Every commit, inside the fence.

blocking-command-unit: scripts/dev.sh test
boot-unit: none

### Hermetic

**What it asserts.** What only a separate process can show:
- the manifest-to-module boot path: `plugins/sub-agent-compact/.claude-plugin/plugin.json`, then `plugins/sub-agent-compact/hooks/hooks.json`, then importing the named module unchanged;
- the options key the engine hands over;
- the per-session log file really written on disk;
- one success and one refusal per operation.

**What it fakes.** A fake engine, `tests/hermetic/engine.ts`, runs as its own Node 22 process. It:
- reads the manifest and `plugins/sub-agent-compact/hooks/hooks.json` and imports the named modules;
- calls `register(on, options)` with the options shaped as `pluginConfigs["<name>@<marketplace>"].options`;
- dispatches the scripted `turn.step` (usage per agentId), `session.compact` (trigger, agentId, messages) and `turn.complete` events from a scenario file under `tests/hermetic/scenarios/`;
- backs `$` with fakes: `fs` over a per-run temp root, `agent.list`, `session.id`, `session.cwd`, `session.usage`, `session.compact`, `env.get`, and a `ui.log` capture;
- records every hook return, every `$` call and every log row.

An unscripted `$` call fails the test by name (Law 2): `unscripted $.<path>(<args>) in <scenario>`.

**Gate.** Every commit, inside the fence.

blocking-command-hermetic: scripts/dev.sh hermetic
boot-hermetic: process

### Live

**What it asserts.** What only real Claude Code shows, on real headless Claude Code on the host:
- the real options key;
- the real event shapes;
- the real compaction.

**Run setup (`brief-live-isolation`).** The live tier runs on the host, never in the fence; no credential is copied into a container. Each run gets:
- a fresh temp project directory under `$TMPDIR`, with `git init` and fixture agents in `.claude/agents/`;
- `--setting-sources project,local`;
- `--settings <run root>/settings.json`, carrying `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and `pluginConfigs["sub-agent-compact@inline"].options`, with `logFile` inside the run root;
- `--plugin-dir <repo>`, plus the recorder fixture plugin as a second `--plugin-dir` (`tests/live/recorder-plugin`);
- `--model haiku`, `--permission-mode bypassPermissions` and `--output-format json`.

The environment is scrubbed of `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set per lane.

A missing login is `ERROR live-login-absent`, never a skip.

**Gate.** Release (a version bump or a push) and the close of each multi-commit piece of work; never the commit gate.

blocking-command-live: scripts/dev.sh live
boot-live: process

### Gates and the fence

The fence (`brief-fence`) is `infra/Dockerfile`: `node:22`, a non-root user with its own `HOME`, and the repository mounted at `/work`. `scripts/dev.sh` runs every verb in the fence except `live`:

- `npm ci` runs once with network into a named `node_modules` volume.
- Every test and check then runs under `docker run --network none`.

A GitHub Actions workflow (`.github/workflows/suite.yml`) runs the same `scripts/dev.sh gate` on every push and pull request.

commit-gate: scripts/dev.sh gate
release-gate: scripts/dev.sh live

`scripts/dev.sh gate` runs `typecheck`, `test`, `hermetic` and `checks`, and writes its combined output to the blocking log.

blocking-log: docs/design/sub-agent-compact-integration-suite/runs/gate-latest.log
close-log: docs/design/sub-agent-compact-integration-suite/runs/close-latest.log

### Shared stores and the double-run

Only the live tier shares stores between tests: the per-session decision log and the engine transcript (section 6). Unit and hermetic tests each get their own temp root.

store-sharing-tiers: live

The unit tier runs twice, once under the base configuration and once under the perturbed one (Law 29), on every commit whose diff touches these paths, and in the scheduled leg:

double-run-trigger-paths: vitest.config.ts package.json package-lock.json tsconfig.json tsconfig.hooks.json hooks/hooks.json .claude-plugin/plugin.json

The perturbed configuration flips every key the environment-reader seam reads, each to a valid alternative:
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW`: unset, then `250000`;
- `HOME`: a read-only temp directory;
- `TZ=Pacific/Chatham` and `LANG=tr_TR.UTF-8`;
- every `userConfig` key (`mainAutoCompact`, `subagentAutoCompact`, `agentDirs`, `logFile`): blank, then a valid alternative.

### Scheduled leg

A weekly cron in `.github/workflows/suite-scheduled.yml` runs:
1. the `env-twice` base and perturbed pair;
2. `vitest run --sequence.shuffle` for the unit and hermetic tiers, with the seed written in the ledger as `order: shuffled:<seed>`;
3. the close job, `scripts/suite-checks.sh --close`, over the landed `runs/`.

The live sequence's ledgers reach `runs/` because the host run lands them with the change that closes the work (`brief-live-isolation`). The schedule window also bounds the close cadence.

schedule-window-days: 7

### LLM-driven steps

llm-rehearsal: none — the product has no LLM-driven steps; haiku only drives Claude Code in the live tier, and every beat asserts the plugin's logged end state, never the model's claim (brief-law5)

## 2. Landscape summary

`landscape.md` holds 27 capabilities. They come from the product's registry, closed-world:
- the three `on(...)` registrations;
- the seven `event:` values that `record` writes;
- the `userConfig` keys in `plugins/sub-agent-compact/.claude-plugin/plugin.json`;
- the `ui.log` lines in `plugins/sub-agent-compact/hooks/sub-agent-compact.ts`.

| Area | Rows | today: NONE |
| --- | --- | --- |
| plugin | 1 | 1 |
| options | 5 | 0 |
| limits | 4 | 0 |
| compact | 7 | 1 |
| readings | 2 | 0 |
| main | 2 | 2 |
| warning | 2 | 2 |
| log | 4 | 2 |
| total | 27 | 8 |

The baseline is `today: NONE` = 8:
- `plugin.load`;
- `compact.error-pass`;
- `main.early-compact` and `main.early-compact-once`;
- `warning.below-window` and `warning.late-ask`;
- `log.write-failure` and `log.no-message-text`.

The existing tests cover `plugins/sub-agent-compact/src/` only. No test runs the hook glue.

**Ruled rows.** The rows on the safety surface are `ruled:yes`, sourced from README rulings (`readme-lookup-failure-passes`) and the redaction ruling (`ruling-log-redaction`):
- `compact.no-reading-pass`;
- `compact.error-pass`;
- `log.no-message-text`.

**Exclusions applied.** The `exclusion` spelling set drops toolchain operations (`typecheck`, `validate:plugin`, `test`). It also drops the vendored engine types in `types/claude-code.d.ts`: a contract the product reads, not a capability.

**The defect row (`brief-window-defect`).** `warning.below-window` compares a limit against the raw `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (`plugins/sub-agent-compact/hooks/sub-agent-compact.ts:85`). Claude Code clamps that value to 100k–1M and to the model's maximum context (`measured-window-floor`). So under 100k the warning names a window the engine does not use. The fix lands in build step 4 with its test watched failing first.

## 3. Existing tests

retired-rows: 0

`retired.tsv` holds its header comment and no rows. The 48 vitest tests in `tests/decisions.test.ts` and `tests/log.test.ts` are kept (`brief-tiers`). No law forces a retirement, so no dispositions are expected.

In build step 4, each `it(...)` is retitled to its kebab `tier-unit:` row name and moved into `tests/unit/<area>.test.ts`. It stays under its `describe(...)` block, the function under test.

A signature is the enclosing symbol (the nearest `describe` title, function or const) plus the normalised statement. That makes each moved assertion a move: its signature reappears in a file the same commit adds, so `retired` needs no row.

The retitled suites also absorb:
- the inline `memoryFs` fake, which moves to the fakes directory (Law 2, 30);
- the weak oracles the `weak-oracle` baseline holds.

## 4. Doors and seams

### Seam plan

- **Engine interface `$`** (`EngineInterface`, `types/claude-code.d.ts`). This is the one seam for the filesystem, environment, session, agent registry and user log. The engine injects it into every handler.
  - Its fake is `tests/fakes/engine.ts`: a scripted `$` that records every call and throws `unscripted $.<path>(<args>)` on a call the scenario does not script.
  - Its contract suite, `tests/contracts/engine.contract.test.ts`, runs the same cases against the fake at unit and hermetic tiers. The live tier checks the real `$` through the recorder plugin's result-shape captures, compared against `tests/goldens/engine-shapes/` (`brief-goldens`, Law 2).
- **Agent filesystem** (`AgentFs`, `plugins/sub-agent-compact/src/agents.ts:27`, built over `$.fs` at `plugins/sub-agent-compact/hooks/sub-agent-compact.ts:96`).
  - Build step 4 moves the adapter into `plugins/sub-agent-compact/src/agent-fs.ts` so a contract can reach it.
  - Its fake is `tests/fakes/memory-agent-fs.ts`, the inline `memoryFs` moved out of `tests/decisions.test.ts`.
  - Its contract suite, `tests/contracts/agent-fs.contract.test.ts`, runs against the fake and against the real adapter over a `$.fs` backed by a real temp directory.
- **Clock.** The one bare door is `new Date()` in `record` (`plugins/sub-agent-compact/hooks/sub-agent-compact.ts:39`). It is kept bare because it writes only the log's `ts`, an unobservable class (`timestamp`), and no decision reads it. It is the single entry of `scripts/suite-checks/bare-doors.baseline`.

fakes-directory: tests/fakes
scratch-migration-directory: none
synthetic-log-fixture-directory: tests/fixtures/synthetic-log
rendered-from-paths: none

The product loads no non-code asset. Its messages are code literals, so the rendered-from set is empty by construction.

### Environment edge-case fixtures

Each fixture below is chosen because the product has the behaviour it probes:

1. **Read-only home.** The log directory is unwritable. `log.write-failure` must log once through `ui.log`, and decisions still go through. This runs as a unit case over the fake `fs.write` fault, and as a hermetic case with a `chmod 0555` temp root. Under a superuser it is `skip-because:root-ignores-permissions`; the fence runs as a non-root user, so that skip never fires there.
2. **Symlinked agent file.** `.claude/agents/<type>.md` is a symlink. The adapter filters `list` results to kind `file` (`plugins/sub-agent-compact/hooks/sub-agent-compact.ts:96`), so a renamed, symlinked definition may be skipped. This is a unit case over the fake.
3. **Case-folding filesystem.** Agent type `Fixture-Reader` against the file `fixture-reader.md`. On the case-sensitive fence filesystem it is `skip-because:case-sensitive-filesystem`; it runs on the macOS host.
4. **CRLF and BOM agent file.** This is an existing unit case.
5. **Window env below the floor.** `CLAUDE_CODE_AUTO_COMPACT_WINDOW=25000` with a limit of 45000: the warning must use 100000. This is the defect test.
6. **Window env above the model's maximum.** `CLAUDE_CODE_AUTO_COMPACT_WINDOW=2000000`: the warning must use the model maximum.
7. **Window env not a number.** `CLAUDE_CODE_AUTO_COMPACT_WINDOW=auto` leaves the native window unset.
8. **A session id carrying path characters.** This is an existing unit case.
9. **A decision log already at 2000 rows.** The cap keeps the newest.
10. **`agent.list` failing mid-session.** The compaction passes, with `why: error`.

### Spelling sets and corpora

The spelling sets live in `scripts/suite-checks/`:
- `assertions.ts`, `doors.ts`, `refused-names.ts`, `refused-id-segments.ts`, `refused-title-ordinals.ts`, `property-words.ts`, `violating-actions.ts`, `exclusion.ts` and `locators.ts`;
- one set per refused shape.

Each set holds one extended regex per line, with `#` lines as comments. Each refused shape also has a planted-violation corpus of three forms under `scripts/suite-checks/corpus/<shape>/`, and a signature baseline `<shape>.baseline`. `names.baseline`, `bare-doors.baseline` and `clones.baseline` hold the other three ratchets. `sigs.awk` is the one signature extractor every ratchet reads through: enclosing symbol, a tab, the normalised statement, never a file or a line.

`exclusions.txt` has two tags:
- `hash` covers the documentation and these ledgers;
- `scope` covers the corpora, the synthetic-log fixtures, `node_modules` and the vendored `types/claude-code.d.ts`.

## 5. Prior art

The research ran two cited passes: the literature, and the nearest neighbour projects. Seven neighbours were mapped against a target of 8–12. Prettier, Vite, Jupyter and Grafana stayed unsettled, and the VS Code CI configuration returned 503.

### Unit

- **Adopted: every fake has its own contract tests against the real implementation.** "A fake must have its own tests to ensure that it conforms to the API of its corresponding real implementation." Source: Software Engineering at Google, ch. 13, <https://abseil.io/resources/swe-book/html/ch13.html>. See also Fowler, ContractTest, <https://martinfowler.com/bliki/ContractTest.html>, and TestDouble, <https://martinfowler.com/bliki/TestDouble.html>. This gives `tests/contracts/*.contract.test.ts`.
- **Adopted: diff-based mutation testing as the audit of the bites.** Mutants over changed lines only, reviewed at the change. Sources: Petrović and Ivanković, State of Mutation Testing at Google, ICSE-SEIP 2018, <https://research.google/pubs/state-of-mutation-testing-at-google/>, and ICSE 2021, <https://arxiv.org/abs/2103.07189>, which found developers write more tests and mutants couple with real faults.
  - The StrykerJS vitest runner is the candidate tool (<https://stryker-mutator.io/docs/stryker-js/vitest-runner/>), with per-test coverage.
  - Its incremental mode misses changes to dependencies, environment and snapshot files (<https://stryker-mutator.io/docs/stryker-js/incremental/>). So a full mutation run follows any change to `tests/fakes/` or `tests/goldens/`.
  - Adoption waits on the owner (section 15); `bites.tsv` is the gate either way.
- **Unverified: the Stryker TypeScript-checker page.** It could not be fetched and is not relied on.

### Hermetic

- **Adopted: hermetic tests with production probers as a separate class.** Source: Software Engineering at Google, ch. 23, <https://abseil.io/resources/swe-book/html/ch23.html>, and Bazel hermeticity, <https://bazel.build/basics/hermeticity>. This gives the fenced `--network none` commit gate, with the live tier as the prober-like release audit.
- **Adopted: feed the plugin captured real inputs instead of hand-written shapes.** The nearest Claude Code neighbour pipes JSON fixtures into pytest and never boots Claude Code (ScottHysom/claude-plugins, <https://github.com/ScottHysom/claude-plugins>). A copied hook schema drifted in agent-bundle #477. A two-week, 100% parse failure followed a docs-versus-binary drift in anthropics/claude-code#67815 (<https://github.com/anthropics/claude-code/issues/67815>). Hence the recorder plugin and the shape goldens (`brief-goldens`).
- **Adopted: the real host program, not a shim, for the top tier.** VS Code's test CLI runs a real Extension Development Host, and JetBrains runs headless and discourages mocking. Obsidian's work-in-progress shim, by contrast, needed a real-app service across versions. Sources: <https://code.visualstudio.com/api/working-with-extensions/testing-extension> and <https://plugins.jetbrains.com/docs/intellij/testing-plugins.html>.
- **Avoided: Pact-style contract brokers** (<https://docs.pact.io/>). There is one consumer and one provider, and the goldens do the job without a broker.
- **Unverified: the Google Testing Blog posts on fakes** and Luo et al., FSE 2014 on flaky-test causes. Neither could be fetched; nothing here rests on them.

### Live

- **Adopted: replay-only in CI.**
  - A missing recording is a hard error; an explicit update path writes the goldens.
  - Recordings keep structure only.
  - Sources: Polly.js expiry and record modes, <https://github.com/Netflix/pollyjs/blob/master/docs/configuration.md>; VCR `:none`, <https://andrewmcodes.gitbook.io/vcr/record_modes/none>; nock back lockdown, <https://github.com/nock/nock>; golden files with an update flag, <https://povilasv.me/go-advanced-testing-tips-tricks/>.
  - VCR's `re_record_interval` (<https://nicolasiensen.gitbook.io/vcr/cassettes/automatic_re_recording>) expires recordings by age.
  - No tool found detects staleness by shape. This design instead re-records at every live run and compares shapes: a differing capture is a red beat (`brief-goldens`).
- **Adopted: a verdict that counts what it checked.** JetBrains Plugin Verifier issue #2090 reported BUILD SUCCESSFUL after checking zero IDEs (<https://github.com/JetBrains/intellij-plugin-verifier/issues/2090>). Every check here errors on zero items scanned.
- **Avoided for now: `claude plugin eval`.** The neighbour pass suggested it alongside `claude plugin validate --strict`, but its sandbox and thresholds were not checked. `claude plugin validate .` stays a toolchain step in `scripts/dev.sh gate`, never a mapped row (Law 25).
- **Measure here:** see below.

### Measured on this host

These are the `measured-*` rows of `references.tsv`, taken with Claude Code 2.1.282 on macOS.

- **Options key.** A `--plugin-dir` plugin's id is `<name>@inline`. Its options are read only from `pluginConfigs["sub-agent-compact@inline"]`; an installed plugin's id is `sub-agent-compact@sub-agent-compact`. With `--setting-sources project,local` plus `--settings`, function hooks were enabled and the limits 500k/40k were taken from the options.
- **Window floor.** `CLAUDE_CODE_AUTO_COMPACT_WINDOW=25000` behaved as 100k. The first ask came at about 76–80k, and Claude Code said "Expected 'auto' or 100k–1M tokens".
- **Frontmatter source.** `autoCompact: 45k` in the temp project's `.claude/agents/fixture-reader.md` resolved, and the log row's `source` names that file.
- **Compaction cost.** A haiku fixture agent reading seven synthetic 42 KB files crossed 80k after six reads, about 13 model requests. One compaction took about 20 s; the run cost $0.30 and took 3 min.
- **Compact boundary.** The engine writes a `compact_boundary` system row to `$HOME/.claude/projects/<cwd slug>/<session id>/subagents/agent-<agentId>.jsonl`. Its `compactMetadata` carries `trigger`, `preTokens`, `postTokens` and `durationMs`.
- **Step overshoot.** The check runs once per model request, so a limit of 100k compacted anywhere between 100k and 177k.

**Still to measure here:**
- the unit and hermetic wall times against their targets (build step 3);
- the live lanes' wall time and spend (build step 7);
- whether Node 22 type stripping imports `plugins/sub-agent-compact/hooks/sub-agent-compact.ts` unchanged (build step 4);
- whether `--resume <session id>` keeps the session id and the per-session log (build step 6);
- the `trigger` value of a plugin-requested main compaction (build step 8);
- whether `$.env.get` reads the variables the harness puts in Claude Code's environment (build step 5).

## 6. Shared state

| Store | Writers | Readers | What can corrupt it | Correlation |
| --- | --- | --- | --- | --- |
| decision log, `decisions.<session id>.jsonl` beside the `logFile` option, under the run root | the plugin (`record`, `plugins/sub-agent-compact/hooks/sub-agent-compact.ts:36`), every lane | every lane's assertions; the after-effect beats | a compaction that reloads the plugin (a second `start` row), a rotated session id (a second file), the row cap (older rows dropped), a concurrent writer (lost append) | session id plus `agentId`; the injected `beat` and `run` once build step 5 lands |
| engine transcript, `$HOME/.claude/projects/<cwd slug>/<session id>/` including `subagents/agent-<agentId>.jsonl` | Claude Code | the compaction beats (`compact_boundary` rows) | a resumed session writing a new file; a cwd slug shared by two runs | session id plus `agentId`; the slug is unique per run because the cwd is |
| temp project, `<run root>/project/.claude/agents/` | the root build | the plugin (`AgentLimits`), Claude Code | an edit between lanes | the run root |
| run-root `settings.json` | the root build, per lane (the window env and options) | Claude Code | a lane leaving its options for the next | the run root |
| recorder captures, `<run root>/captures/` | the recorder plugin | the `golden` verb | message text leaking in (refused by structure-only redaction) | session id plus event name |

There is no third-party state. The API spend is not state: it is reported as `spends:`.

The engine transcript sits under the host's real `$HOME`, which holds the login (`brief-live-isolation`). The run's final step deletes exactly the slug directory its own temp cwd produced.

## 7. Lanes

Three lanes run in one sequence on one run root, carrying session `S`. The harness assigns `S` with `--session-id <uuid>`, and later lanes pass `--resume <uuid>`. The rows are in `beats.md`.

1. **`plugin-load`** (builder). It creates the run root, session `S` and the first `start` row that later lanes read.
   - `need run-root`: create the temp project, `git init`, write the fixture agents and the synthetic read files, and write `settings.json`. This is a no-op when the root hash matches.
   - `need login`: `claude auth status` exits 0, else `ERROR live-login-absent`.
2. **`subagent-compaction`** (builder, then reader). It grows the richest log: a sub-agent's held and passed asks, on top of `plugin-load`'s rows.
   - `need session`: session `S` resumes, else a fresh `S` with its `start` row.
   - `need fixture-reader`: `.claude/agents/fixture-reader.md` with `autoCompact: 120k`.
   - The window is `100000`.
3. **`main-compaction`** (destroyer). It compacts the main chat's own context, the heaviest mutation of the shared session, so it runs last.
   - `need session`: as above.
   - `mainAutoCompact` is set to `100k`.

The lanes run in sequence (Law 6); no parallel mode is declared. Each lane's `need` preludes are listed above.

### Rows per lane

- `plugin-load/options-reach-start-row`: options 500k/40k give a `start` row with `mainAutoCompact` 500000 and `subagentAutoCompact` 40000.
- `subagent-compaction/reader-ask-held-below-limit`: the first `auto` ask for `fixture-reader`, at about 80k, is held with the reason naming 120000.
- `subagent-compaction/reader-ask-passes-at-limit`: a later ask passes with `why: at-limit` and `tokens` ≥ 120000. The engine transcript shows a `compact_boundary` with `trigger: auto` and `preTokens` ≥ 120000. `source` names `fixture-reader.md`.
- `subagent-compaction/log-kept-after-compaction`: the after-effect beat. It asserts that the log still holds `plugin-load`'s `start` row and the held row, and that the `start` row count equals the carried process count.
- `main-compaction/main-compacted-at-turn-end`: a `turn.complete` row with `action: compact`, then a `turn.complete.compacted` row, then a `session.compact` row with `why: requested`.
- `main-compaction/log-kept-after-main-compaction`: the after-effect beat. `subagent-compaction`'s rows for `fixture-reader` are still in `S`'s file.

Every beat also runs `golden` over the recorder captures of the events it caused, against `tests/goldens/engine-shapes/`. There is no separate recorder lane.

## 8. Crossings

| Crossing | Lanes | Why twice |
| --- | --- | --- |
| the per-session decision log `decisions.<S>.jsonl` | `plugin-load` writes it, `subagent-compaction` and `main-compaction` read and extend it | A compaction that reloads the plugin writes a second `start` row, and one that rotates the session id starts a second file. Either hides inside a single lane, whose own rows still look complete. Only a later lane reading an earlier lane's rows sees the loss. |
| the engine session `S` resumed across lanes | `plugin-load` creates it, the two compaction lanes resume it | A `--resume` that forks a new session id makes each lane green alone while the log splits. |

The after-effect beats (Law 9):

- After `subagent-compaction/reader-ask-passes-at-limit`, `plugin-load`'s `start` row still names 500000/40000 in `S`'s file, and exactly one `start` row exists per carried process (`subagent-compaction/log-kept-after-compaction`).
- After `main-compaction/main-compacted-at-turn-end`, `subagent-compaction`'s held and passed rows for `fixture-reader` are still in `S`'s file (`main-compaction/log-kept-after-main-compaction`).

Both map `log.session-file` with `crossing:`, each carrying `twin:tier-unit:log-file-per-session-path`.

## 9. Map and observed coverage

`map.tsv` maps all 27 landscape ids:
- to 25 unit rows, 6 hermetic rows and 6 beats;
- counting a crossing's two sides, 39 map rows in all.

Every mapped row is listed in `pending.txt` until it is defined, so the list starts at all 37 rows.

The operation names come from the product itself. Claude Code loads the hook module verbatim, so the module is the built product:

```sh
# registry dump: the handlers the module registers and the events it records
grep -oE "on\('[a-z.]+'" plugins/sub-agent-compact/hooks/sub-agent-compact.ts | sed "s/on('//; s/'//"
grep -oE "event: '[a-z.-]+'" plugins/sub-agent-compact/hooks/sub-agent-compact.ts | sed "s/event: '//; s/'//"
# options surface: the userConfig keys
node -e 'console.log(Object.keys(require("./.claude-plugin/plugin.json").userConfig).join("\n"))'
```

Once build step 4 lands, `node tests/hermetic/engine.ts --dump-ops` replaces the first two lines. It boots the module and prints the handler names that `register` passed to `on`, plus the `event` values a full scenario sweep recorded.

The checks run in two halves:
- the plan half (`map-ids`, `map-beats`, `map-names`, `map-dup`, `landscape-scope`) runs from the first commit;
- the proof half (`observed`) runs at `--close` over the canonical ledger.

The harness injects each row's id as `SUB_AGENT_COMPACT_BEAT` and the run id as `SUB_AGENT_COMPACT_RUN`. Build step 5 makes `record` stamp both on every row, so only rows carrying that id credit the mapped row.

A tier row `tier-unit:<name>` or `tier-hermetic:<name>` is defined by a test whose title is exactly `<name>`. A beat `<lane>/<slug>` is defined by `beat('<lane>/<slug>', …)` in `tests/live/lanes/<lane>.lane.ts`.

## 10. Activity log

The decision log is the activity log (Law 17):
- one JSON-lines file per session, `decisions.<session id>.jsonl`, beside the `logFile` option (`plugins/sub-agent-compact/src/log.ts:6`);
- resolved in `start` from the option or the default under `$HOME` (`plugins/sub-agent-compact/hooks/sub-agent-compact.ts:75`).

The live and hermetic tiers point `logFile` inside the run root, so the harness reads one destination per run.

**Level.** Every record is written, with no level filter, in every environment. The file is the product's audit of each decision, so test, pre-release and production all write at the debug equivalent. Operator-facing lines go through `$.ui.log`. That is a user-visible output, not a second log: its lines are asserted by golden (`log.write-failure`) and it is not in the Second logging path set.

**Record fields.** Today a record carries `ts`, `event` and the row's fields:
- `trigger`, `party` and `agentId`;
- `type`, `limit`, `source` and `tokens`;
- `lastResponseTokens` and `messages` (a count);
- `decision`, `why` and `error`.

Build step 5 adds `op` (equal to `event`), `level`, `pid`, `version` (from `plugin.json`), `session`, and the injected `beat` and `run`. `record` reads the last two once through `$.env.get('SUB_AGENT_COMPACT_BEAT')` and `$.env.get('SUB_AGENT_COMPACT_RUN')` in `start`. The wrapping sits at the `record` seam, not at the call sites.

**Rotation.** One file per session, capped at `LOG_CAP` = 2000 rows, with the newest kept (`plugins/sub-agent-compact/hooks/sub-agent-compact.ts:10`, `plugins/sub-agent-compact/src/log.ts:18`).

**Buffer handler.** At unit and hermetic tiers, the fake engine's `fs.write` capture for the log path plus its `ui.log` capture, per test. The ledger reporter writes each test's `op` set from it.

**Reader.** The beat library's `log` reader. It records the file's byte offset before each beat, reads the slice after it, and filters by `op`, `agentId`, `beat` and time.

**Redaction ruling (`ruling-log-redaction`).** No row carries message text, a prompt, a tool result or a credential; `messages` is a count. The redaction test is `tier-unit:rows-carry-no-message-text`. It plants a secret string in the messages of a `session.compact` event and in a tool result, and asserts that the string appears in no written row and no `ui.log` line. The recorder plugin applies the same rule to its captures: keys, types and lengths only.

**Synthetic records.** Log-shape fixtures live only in `tests/fixtures/synthetic-log/`, with `run: "synthetic"`.

## 11. Speed

The owner ruled the targets (`brief-numbers`).

target-unit-ms: 5000
target-hermetic-ms: 60000
target-live-sequence-ms: 900000
budget-headroom-pct: 25

### Paper cost

These are the `cost_ms` sums from `beats.md`, based on the measured 3 min and $0.30 for seven reads with one compaction.

| Key | Paper cost | Target | Notes |
| --- | --- | --- | --- |
| `tier-unit` | ~1,500 ms | 5,000 ms | 48 existing tests plus the new rows, in-process |
| `tier-hermetic` | ~9,000 ms | 60,000 ms | six process boots at about 1,500 ms each |
| `plugin-load` | 30,000 ms | | one short headless run |
| `subagent-compaction` | 300,200 ms | | about 12 reads, one held ask, one compaction of about 20 s |
| `main-compaction` | 240,200 ms | | the main chat reading past 100k, then one compaction |

The live critical path is the whole sequence, about 570,400 ms. With 25% headroom that is about 713,000 ms, inside the 900,000 ms target, so no re-cut is needed. Spend is about $1 of haiku per sequence (`spends:` on each beat).

### Per-change policy (Law 20)

- **Every commit:** unit, hermetic and the checks, inside the fence.
- **A change to a lane file or to the product under a lane's rows:** that lane from its checkpoint, then alone from a fresh root.
- **At release and at each close:** the full sequence.
- **Budgets:** pinned from three green canonical runs on one root hash, in `budgets.tsv`.

There is no parallel mode.

## 12. Harness contract

goldens-directory: tests/goldens
size-ceiling: 300
clone-threshold-tokens: 50
lane-file-pattern: tests/live/lanes/*.lane.ts
test-name-pattern: *.test.ts
output-filter: none — scripts/dev.sh passes each tier's exit code and output through unchanged

**`size-ceiling`** is 300 lines. The largest test file today is 192 lines, and 300 leaves room for one table-driven file per area without a lane file outgrowing a single journey segment.

**Clone threshold.** The detector is jscpd with `--min-tokens 50`, added as a pinned devDependency in build step 2. Fifty tokens flags a copied `it` block with its fixture setup, while shorter matches are the repeated `expect(decide({...}))` table rows that belong together.

### Library, runner and recorder

**Library** (`tests/live/beat.ts`). The verbs are `beat`, `assert`, `golden`, `pass`, `fail`, `known`, `blocked`, `skipBecause`, `need`, `spends`, `expectLog` and `poll`. It is the only reader of the decision log, the engine transcript and the recorder captures.
- `poll` waits on a named condition with a bound. An example is `poll('boundary-written', () => transcript has compact_boundary for agentId, 120000)`.
- It reads a child `claude` process's output only after the child exited.
- It keys every reply by beat id.
- `golden` refuses bytes that differ from the tracked blob.

**Runner** (`tests/live/run.ts`, driven by `scripts/dev.sh live`). It takes `[--lanes …] [--from checkpoint:<lane>] [--root reuse|rebuild] [--dry-run]`.
- One run root runs lanes in canonical order, whatever order is given.
- It keeps going after a red beat.
- It streams `✓`, `✗`, `known`, `blocked-by <beat>` and `skip-because <reason>` lines with the lane prefix.
- Exit 1 means a failure outside `gaps.tsv`, an unmapped id or a budget breach. Exit 2 means it could not run, which includes a missing login.

**Recorder plugin** (`tests/live/recorder-plugin/`, named `sub-agent-compact-recorder`). It registers the same three events and writes, per event, the input's structure (keys, types, array lengths) and the structure of each `$` result it reads. The update path is `node tests/live/update-goldens.ts <run id>`: it copies a run's captures into `tests/goldens/engine-shapes/` for review in the output's commit, and never runs inside a comparison.

### Run ledger

Ledgers are `runs/<run id>.ledger`, one file per run. The header lines are:
- `command:`, `mode:` and `lanes-before:`;
- `boot:` and `runner_pid:`;
- `order:` and `config:`;
- `root:`, `tree-start:`, `dirty-start:`, `tree-end:` and `dirty-end:`;
- `started:`, `load:` and `cores:`.

Then come tab-separated rows, `row⇥verdict⇥assertions-by-id⇥expected⇥ops⇥goldens⇥wall_ms⇥t+s`, and per lane `lane⇥wall_s⇥beats⇥failed⇥known⇥blocked⇥skipped`.
- The unit and hermetic tiers write the same header through `tests/support/ledger-reporter.ts`, a vitest reporter, with `mode: tier`, `boot: none` for unit and `boot: process` for hermetic.
- `scripts/suite-checks.sh` output is kept in the blocking log.
- The product's log for a run is copied to `runs/<run id>.log`.

**Failure block** (one per failed row, before the verdict line). It names:
- the row id and `file:line`;
- the expected value, the actual value and the source;
- the first error record in the row's log slice;
- the absolute run directory, ledger and log paths.

### Checkpoints and root hash

**Checkpoints.** After each lane, the runner archives the run root (the project, `settings.json`, the log, the captures) and the transcript slug directory to `$TMPDIR/sub-agent-compact-checkpoints/<root hash>-<lane>.tar`. `--from checkpoint:<lane>` restores the archive and resumes `S`. A checkpoint holds no credential.

**Root hash inputs:**
- `plugins/sub-agent-compact/hooks/`, `plugins/sub-agent-compact/src/` and `.claude-plugin/`;
- `tests/live/fixtures/` (agents, synthetic read files, the settings template);
- `tests/live/recorder-plugin/`;
- `claude --version` and the model name.

**Isolation.** Each run gets its own temp project, run root, log file and transcript slug. The host's `$HOME` is shared only for the login (`brief-live-isolation`).

### Self-tests

The self-tests are listed in `self-tests.txt`. Each is watched failing before its code exists. They cover:
- every check's could-not-look inputs, and one planted violation per check;
- the runner: keep-going, a missing login, a killed run, and the failure block of a planted red;
- the beat library: refusing a live child's output and a mismatched reply;
- the fence's refused outbound socket (Law 1);
- the engine fake's unscripted call, named (Law 2);
- both contract suites;
- the redaction test (Law 17);
- the all-keys-blank boot (Law 30). All option keys blank boots on the documented defaults with one `start` row and no `option-error` row. The plugin has no required key: section 15, first item.

## 13. Build order

1. **Run isolation and the ledger's tree binding.**
   - `infra/Dockerfile`: node:22, a non-root user, its own `HOME`.
   - `scripts/dev.sh` with the verbs `test`, `typecheck`, `hermetic`, `checks`, `gate` and `live`. `live` runs on the host only.
   - `.github/workflows/suite.yml` (the gate) and `.github/workflows/suite-scheduled.yml` (env-twice, shuffle, `--close`).
   - `tests/support/ledger-reporter.ts` writing `tree-start`, `tree-end`, `dirty-start` and `dirty-end`.
   - `vitest.config.ts`: reporter, `include: ['tests/**/*.test.ts']`, no retry.
2. **The collected census and the check self-tests.**
   - `tests/checks/*.test.ts`, which run `scripts/suite-checks.sh` over planted trees, per `self-tests.txt`.
   - jscpd pinned in `package.json` `devDependencies`.
3. **Wall-time budgets for unit and hermetic.** Three green runs pinned into `budgets.tsv` under `tier-unit` (and `tier-hermetic` once step 4 lands). This is measured here.
4. **Seams, fakes and contracts, the defect, then the unit conversion.**
   - `tests/fakes/engine.ts` and `tests/fakes/memory-agent-fs.ts`.
   - `plugins/sub-agent-compact/src/agent-fs.ts` (the adapter moved out of `plugins/sub-agent-compact/hooks/sub-agent-compact.ts:96`).
   - `tests/contracts/engine.contract.test.ts` and `tests/contracts/agent-fs.contract.test.ts`.
   - `tests/hermetic/engine.ts` plus `tests/hermetic/scenarios/` and `tests/hermetic/*.test.ts`.
   - **The window defect, watched failing first.** Write `tier-unit:below-window-warning-uses-clamped-window` in `tests/unit/warning.test.ts`. Then add `effectiveWindow(raw, modelMax)` in `plugins/sub-agent-compact/src/window.ts`, clamping to 100000–1000000 and to the model's maximum context, used at `plugins/sub-agent-compact/hooks/sub-agent-compact.ts:85`. Then add the 100k floor to `README.md` `## The window rule`.
   - Then the retitle and move of the 48 tests into `tests/unit/<area>.test.ts`, with the new glue rows, `weak-oracle` and `tautological-oracle` burned to 0, and each row's bite in `bites.tsv`.
5. **The activity log fields, then the recorder and goldens.**
   - `plugins/sub-agent-compact/hooks/sub-agent-compact.ts` `record` and `start`: `op`, `level`, `pid`, `version`, `session`, `beat`, `run`.
   - `tier-unit:rows-carry-no-message-text`.
   - `tests/fixtures/synthetic-log/`.
   - `tests/live/recorder-plugin/`, `tests/live/update-goldens.ts` and `tests/goldens/engine-shapes/`, from a first recorded run.
6. **The harness, proven with `plugin-load` in sequence and alone.**
   - `tests/live/beat.ts`, `tests/live/run.ts`, `tests/live/fixtures/` and `tests/live/lanes/plugin-load.lane.ts`.
   - This proves `--resume` keeps `S` and the log.
7. **`subagent-compaction`, then speed.**
   - `tests/live/lanes/subagent-compaction.lane.ts`.
   - Wall time and spend measured against 900000 ms before a third lane.
8. **`main-compaction`.**
   - `tests/live/lanes/main-compaction.lane.ts`, with its after-effect beat and bites.
   - The plugin trigger value pinned in `tests/goldens/engine-shapes/`.
   - The lane budgets pinned from three runs.
9. **The retirement ledger verified.** `retired.tsv` stays empty, since no test is deleted; `retired` passes on the move-only diff.
10. **Close.**
    - Three green sequences on the merge subject, budgets pinned from them, no flake, and `pending.txt` empty.
    - `scripts/dev.sh live` wired into the release procedure (the version bump in `plugins/sub-agent-compact/.claude-plugin/plugin.json`).

**The checks on the tree as written (2026-09-25).** `sh scripts/suite-checks.sh` exits 2. Thirteen checks pass: map-ids, map-beats, map-names, map-dup, landscape-scope, names, oracle, copy, gaps, budgets, retired, bare-doors, size, with `env-twice` at `PASS not-due`. Four report could-not-look, each by name, each cleared by a build step:

- `collected`: no `.github/workflows` (step 1);
- `self-tests`: no blocking log (steps 1 and 2);
- `clones`: jscpd absent (step 2);
- `refused-shapes`: `unscoped-read` and `consuming-probe` scan zero items until `tests/live/` and `scripts/dev.sh` exist (steps 1 and 6), and `machine-in-a-fixture` until `tests/fixtures/` and `tests/live/fixtures/` exist (steps 5 and 6). The other thirteen shapes catch their corpus and stay within baseline.

The ratchet baselines hold today's counts: `weak-oracle` 1, `tautological-oracle` 3, `double-in-production` 1, `bare-doors` 1, every other shape and `names` 0, `clones` 0.

## 14. Not covered

- **Whether `precompute` fires for sub-agents.** Every live ask observed was `auto`. The `decide` unit cases cover `precompute`, but no live beat can trigger it on demand, so `compact.subagent-hold` is proven live for `auto` only. Once a reproducible trigger is found it becomes a probe (section 15).
- **The engine's window floor and ceiling across Claude Code releases.** `measured-window-floor` is one observation on 2.1.282. The engine-shape goldens catch event-shape drift, but not a changed clamp. Re-observe at each release by running `plugin-load` with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=25000` and reading the first ask's tokens.
- **Other engines and surfaces.** Claude Code on the web, IDE hosts and non-macOS hosts: the live tier runs on the owner's macOS host only.
- **The exact overshoot per compaction.** The check runs once per model request, so where between the limit and one step past it a compaction lands is unobservable (`token-count-overshoot`). Beats assert `tokens ≥ limit`, never an exact figure.

## 15. Open rulings

1. **The plugin boots on defaults instead of refusing to boot (Law 30).** An invalid value is named in an `option-error` row and `ui.log`, then replaced by its default; a relative `logFile` turns logging off with a named error. **Recommendation: keep.** Every key is optional with a documented default, and a plugin that refused to boot would silently hand every session back to native compaction. The Law 30 self-test becomes the all-keys-blank boot on defaults.
2. **Three lanes, below the five-to-nine guidance.** The product has one integration surface and no roles, tenants or destructive tail. **Recommendation: accept three.**
3. **The ratchet burn-down pace.** **Recommendation:**
   - `weak-oracle.baseline` gains `# ceiling <end of build step 4> 0`;
   - `double-in-production.baseline` (the inline `memoryFs`) reaches 0 in the same step;
   - `tautological-oracle.baseline` (the two `DEFAULT_*` constants and the `estimateTranscript(...)` call on the expected side, all in `tests/decisions.test.ts`) reaches 0 in the same step, each expected value rewritten as a literal;
   - `bare-doors.baseline` stays at 1.
   Today's ceilings equal today's counts.
4. **Diff-based mutation testing (StrykerJS) as a scheduled audit of the bites.** **Recommendation:** adopt after close, on the diff only, never as a gate.
5. **The live tier's shared `$HOME`.** Law 29 asks for a per-run home, but the login lives in the host's home and copying it rotates the token (`brief-live-isolation`). **Recommendation:** keep the real home. Scrub the environment, pass `--setting-sources project,local`, and delete the run's own transcript slug at the end.
6. **The decision-log redaction rule (`ruling-log-redaction`).** No decision-log row carries message text, a prompt, a tool result or a credential; `messages` is a count. The rule is this design's, derived from the structure-only captures of `brief-goldens` and Law 17, not stated by the owner. **Recommendation: ratify.** Until then `log.no-message-text` stays `ruled:yes` on this design's ruling, and a product change that loosens it needs the owner's ruling in the same commit.
