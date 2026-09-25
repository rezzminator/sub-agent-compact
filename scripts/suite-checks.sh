#!/bin/sh
# suite-checks.sh [--close]: one CHECK line per row; exit 0 clean, 1 on a finding, 2 when a check could not run
# SUITE_CHECKS_DUMP=<dir>: every ratchet also writes its current signatures to <dir>/<baseline name>, the one way a baseline is regenerated
set -u; export LC_ALL=C
MODE=${1:-plain}; case $MODE in plain|--close) ;; *) echo "usage: $0 [--close]" >&2; exit 2;; esac
S=docs/design/sub-agent-compact-integration-suite; MAIN=main; LNG=ts; SRC='^(src|hooks)/.*\.ts$'; OWN_IDS='rezzminator/sub-agent-compact|sub-agent-compact#[0-9]'
DOC="$S/design.md"; K=scripts/suite-checks; rc=0; TAB=$(printf '\t')
say() { printf 'CHECK %s %s %s\n' "$1" "$2" "$3"; case $2 in FAIL) [ "$rc" -ge 1 ] || rc=1;; ERROR) rc=2;; esac; }
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { say setup ERROR "not inside a repository"; exit 2; }
T=$(mktemp -d) || { say setup ERROR "mktemp failed"; exit 2; }; trap 'rm -rf "$T"' EXIT
MB=$(git merge-base HEAD "$MAIN" 2>/dev/null) || { say setup ERROR "merge base unreadable"; exit 2; }
at() { if git cat-file -e "$MB:$1" 2>/dev/null; then git show "$MB:$1"; else cat "$1"; fi; }
excuse() { [ -r "$1" ] || return 1; at "$1" | grep -v '^#' | sort > "$T/e1"; grep -v '^#' "$1" | sort > "$T/e2"; comm -12 "$T/e1" "$T/e2"; }
oblige() { git cat-file -e "$MB:$1" 2>/dev/null || [ -r "$1" ] || return 1; { at "$1"; cat "$1"; } 2>/dev/null | grep -v '^#' | sort -u; }
lower() { if [ "$1" -le "$2" ]; then echo "$1"; else echo "$2"; fi; }
ceil_in() { awk -v d="$(date +%Y-%m-%d)" '$1=="#" && $2=="ceiling" && $3<=d && $3>=m {m=$3; c=$4} END {if (c=="") exit 1; print c+0}'; }
ceiling() { w=$(ceil_in < "$1") || return 1; a=$(at "$1" | ceil_in) || a=$w; lower "$a" "$w"; }
val_in() { awk -F': ' -v k="$1" '$1==k {print $2+0; f=1; exit} END {if (!f) exit 1}'; }
value() { w=$(val_in "$1" < "$DOC") || return 1; a=$(at "$DOC" | val_in "$1") || a=$w; lower "$a" "$w"; }
ratchet() { [ -z "${SUITE_CHECKS_DUMP:-}" ] || sort "$3" > "$SUITE_CHECKS_DUMP/${2##*/}"
  [ "$4" -gt 0 ] || { say "$1" ERROR "zero items scanned"; return; }
  c=$(ceiling "$2") || { say "$1" ERROR "baseline $2 unreadable or no ceiling in force"; return; }
  excuse "$2" > "$T/base" || { say "$1" ERROR "baseline $2 unreadable"; return; }
  sort "$3" > "$T/cur"; over=$(comm -13 "$T/base" "$T/cur" | tr '\n' ';'); nb=$(( $(wc -l < "$T/base") ))
  if [ -n "$over" ]; then say "$1" FAIL "beyond baseline: $over"
  elif [ "$nb" -gt "$c" ]; then say "$1" FAIL "baseline holds $nb, above ceiling $c"
  else say "$1" PASS "$4 scanned, $(( $(wc -l < "$T/cur") )) signatures, none beyond baseline"; fi; }
excuse "$S/exclusions.txt" > "$T/excl" || { say setup ERROR "exclusions.txt unreadable"; exit 2; }
tagged() { while IFS= read -r f; do while IFS="$TAB" read -r g t; do [ "$t" = "$1" ] && case $f in $g) printf '%s\n' "$f"; break;; esac; done < "$T/excl"; done; }
untagged() { while IFS= read -r f; do hit=; while IFS="$TAB" read -r g t; do [ "$t" = "$1" ] && case $f in $g) hit=1; break;; esac; done < "$T/excl"; [ -n "$hit" ] || printf '%s\n' "$f"; done; }
scoped() { git ls-files -co --exclude-standard | untagged scope | while IFS= read -r f; do [ ! -f "$f" ] || printf '%s\n' "$f"; done; }
subject_tree() { cp "$(git rev-parse --git-path index)" "$T/idx" && git ls-files | tagged hash | GIT_INDEX_FILE="$T/idx" git update-index --force-remove --stdin && GIT_INDEX_FILE="$T/idx" git write-tree; }
subject_dirty() { { git diff --name-only; git ls-files -o --exclude-standard; } | untagged hash | sort -u | while IFS= read -r f; do
  if [ -f "$f" ]; then printf '%s %s\n' "$(git hash-object -- "$f")" "$f"; else printf 'deleted %s\n' "$f"; fi; done > "$T/dirty"
  [ ! -s "$T/dirty" ] || git hash-object "$T/dirty"; }
marked() { awk -v h="$1" 'f && NF {print; exit} $0 ~ "^## [0-9]+\\. " h "$" {f=1} index($0, h ": none — ") == 1 {print "none — "; exit}' | grep -q '^none — '; }
none_gate() { { at "$DOC" | marked "$2"; } && marked "$2" < "$DOC" || return 1
  if eval "$3"; then say "$1" ERROR "NONE-AMBIGUOUS: $2 marked none, an artifact exists"; else say "$1" PASS "none:$2"; fi; }

# ---- adaptation: sub-agent-compact ----
LAND="$S/landscape.md"; BEATS="$S/beats.md"; MAP="$S/map.tsv"; PEND="$S/pending.txt"; RUNS="$S/runs"; HOOK=hooks/sub-agent-compact.ts
TODAY=$(date +%Y-%m-%d); NOW=$(date +%s)
SHAPES="fail-open-verdict weak-oracle tautological-oracle unscoped-read wall-clock-wait consuming-probe toolchain-as-product shipped-migration-content lint-as-test tombstone self-skip double-in-production test-cited-by-production second-logging-path line-anchored-exemption machine-in-a-fixture"
sval() { awk -v k="$1" 'index($0, k ": ") == 1 {print substr($0, length(k) + 3); f = 1; exit} END {if (!f) exit 1}' "$DOC"; }
# sigs <spelling file>: file list on stdin, one "<enclosing symbol>TAB<normalised statement>" per matching line; awk exits 3 on an empty set
sigs() { p=$1; set --; while IFS= read -r f; do [ ! -f "$f" ] || set -- "$@" "$f"; done; [ $# -gt 0 ] || return 0; awk -v pats="$p" -f "$K/sigs.awk" "$@"; }
rows() { grep -E '^(tier-(unit|hermetic):[a-z0-9-]+|[a-z][a-z0-9-]*/[a-z0-9-]+) · ' "$BEATS"; }
maprows() { sed 1d "$MAP" | cut -f2 | sort -u; }
tests_all() { git ls-files -co --exclude-standard -- tests | untagged scope | while IFS= read -r f; do [ -f "$f" ] || continue; case ${f##*/} in $(sval test-name-pattern)) printf '%s\n' "$f";; esac; done; }
lanes_all() { for f in $(sval lane-file-pattern); do [ ! -f "$f" ] || printf '%s\n' "$f"; done; }
titles() { while IFS= read -r f; do grep -oE "(^|[^A-Za-z0-9_.])(it|test)\\(['\"][^'\"]+" "$f" | sed -E "s/^.*\\(['\"]//"; done; }
defined() { tests_all | while IFS= read -r f; do case $f in tests/hermetic/*) p=tier-hermetic;; *) p=tier-unit;; esac; printf '%s\n' "$f" | titles | sed "s/^/$p:/"; done
  lanes_all | while IFS= read -r f; do grep -oE "beat\\(['\"][a-z0-9/-]+" "$f" | sed -E "s/^beat\\(['\"]//"; done; }
led() { for l in "$RUNS"/*.ledger; do [ ! -f "$l" ] || printf '%s\n' "$l"; done; }
extract_doors() { sigs "$T/spell"; }

chk_map_ids() { grep -oE '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*' "$S/landscape.md" 2>/dev/null | sort -u > "$T/L"
  sed 1d "$S/map.tsv" 2>/dev/null | cut -f1 | sort -u > "$T/M"
  if [ ! -s "$T/L" ] || [ ! -s "$T/M" ]; then say map-ids ERROR "DERIVE-FAILED: no ids read from the landscape or the map"; return; fi
  d=$(comm -3 "$T/L" "$T/M" | tr -d '\t' | tr '\n' ' ')
  if [ -n "$d" ]; then say map-ids FAIL "unmatched: $d"; else say map-ids PASS "$(( $(wc -l < "$T/L") )) ids, each mapped"; fi; }

chk_map_beats() { rows 2>/dev/null | cut -d' ' -f1 | sort -u > "$T/R"
  [ -s "$T/R" ] || { say map-beats ERROR "DERIVE-FAILED: no rows read from $BEATS"; return; }
  [ -r "$PEND" ] || { say map-beats ERROR "pending.txt missing"; return; }
  maprows > "$T/MR" 2>/dev/null; [ -s "$T/MR" ] || { say map-beats ERROR "DERIVE-FAILED: no rows read from the map"; return; }
  defined | sort -u > "$T/D"; grep -v '^#' "$PEND" | sed '/^$/d' | sort -u > "$T/P"; f=
  x=$(comm -23 "$T/MR" "$T/R" | tr '\n' ' '); [ -z "$x" ] || f="$f no-beats-row: $x;"
  x=$(comm -13 "$T/MR" "$T/R" | tr '\n' ' '); [ -z "$x" ] || f="$f beats-row-unmapped: $x;"
  x=$(comm -23 "$T/MR" "$T/D" | comm -23 - "$T/P" | tr '\n' ' '); [ -z "$x" ] || f="$f undefined-not-pending: $x;"
  x=$(comm -12 "$T/D" "$T/P" | tr '\n' ' '); [ -z "$x" ] || f="$f defined-still-pending: $x;"
  x=$(comm -13 "$T/MR" "$T/P" | tr '\n' ' '); [ -z "$x" ] || f="$f pending-not-mapped: $x;"
  np=$(( $(wc -l < "$T/P") )); [ "$MODE" = plain ] || [ "$np" -eq 0 ] || f="$f $np rows still pending at close;"
  if [ -n "$f" ]; then say map-beats FAIL "$f"
  else say map-beats PASS "$(( $(wc -l < "$T/MR") )) mapped rows, $(( $(comm -12 "$T/MR" "$T/D" | wc -l) )) defined, $np pending"; fi; }

chk_map_names() { { grep -oE "on\\('[a-z.-]+'" "$HOOK" | sed "s/on('//; s/'//"; grep -oE "event: '[a-z.-]+'" "$HOOK" | sed "s/event: '//; s/'//"; } 2>/dev/null | sort -u > "$T/reg"
  [ -s "$T/reg" ] || { say map-names ERROR "DERIVE-FAILED: registry dump of $HOOK empty"; return; }
  grep -oE ' · op:[a-z.-]+' "$LAND" 2>/dev/null | sed 's/ · op://' | sort -u > "$T/ops"
  [ -s "$T/ops" ] || { say map-names ERROR "no op: fields read from the landscape"; return; }
  f=; x=$(comm -23 "$T/reg" "$T/ops" | tr '\n' ' '); [ -z "$x" ] || f="$f reported-not-in-landscape: $x;"
  x=$(comm -13 "$T/reg" "$T/ops" | tr '\n' ' '); [ -z "$x" ] || f="$f landscape-op-not-reported: $x;"
  grep -E '^[a-z][a-z0-9-]*\.[a-z]' "$LAND" | awk -F' · ' '{print $1" "$NF}' > "$T/fl"; na=0
  while read -r id fl; do p=${fl%:*}; n=${fl##*:}; na=$((na + 1))
    case $n in ''|*[!0-9]*) f="$f $id has no file:line;"; continue;; esac
    if [ ! -f "$p" ] || [ "$(( $(wc -l < "$p") ))" -lt "$n" ]; then f="$f $id: $fl does not exist;"; fi; done < "$T/fl"
  if [ "$MODE" != plain ]; then for e in $(grep -oE ' · evidence:[^ ]+' "$LAND" | sed 's/ · evidence://'); do [ -f "$e" ] || f="$f evidence $e absent;"; done; fi
  if [ -n "$f" ]; then say map-names FAIL "$f"
  else say map-names PASS "$(( $(wc -l < "$T/ops") )) ops equal the registry dump, $na file:line anchors resolve"; fi; }

chk_map_dup() { [ "$(( $(sed 1d "$MAP" 2>/dev/null | wc -l) ))" -gt 0 ] || { say map-dup ERROR "no map rows read"; return; }
  awk -F' · ' '/^[a-z][a-z0-9-]*\.[a-z]/ {op=""; k=""; for (i = 2; i <= NF; i++) {if ($i ~ /^op:/) op = substr($i, 4); if ($i ~ /^evidence:/) op = $i; if ($i ~ /^kind:/) k = substr($i, 6)} print $1 "\t" op "\t" k}' "$LAND" > "$T/lk"
  out=$(awk -F'\t' 'FNR == NR {op[$1] = $2; kd[$1] = $3; next} FNR == 1 {next}
    { id = $1; r = $2; why = $3; t = (r ~ /^tier-unit:/) ? "unit" : (r ~ /^tier-hermetic:/) ? "hermetic" : "live"; tier[r] = t; rows[r] = 1; cross = (why ~ /^crossing:/)
      if (cross) {split(r, a, "/"); cl[a[1]] = 1; nc++}
      if (!cross && ++per[id SUBSEP t] == 2) f = f " " id "-twice-at-" t ";"
      if (t != "unit" && !cross) {key = t SUBSEP op[id] SUBSEP kd[id]; if (!((key SUBSEP r) in seen)) {seen[key SUBSEP r] = 1; if (++opn[key] == 2) f = f " second-" kd[id] "-row-for-" op[id] "-at-" t ";"}}
      if (t == "live" && why !~ /twin:/ && why !~ /live-only/) f = f " " r "-neither-twin-nor-live-only;"
      if (match(why, /twin:[^ ]+/)) tw[r] = substr(why, RSTART + 5, RLENGTH - 5)
      if (t == "hermetic") h[id] = 1; if (t == "unit") u[id] = 1 }
    END { for (r in tw) {if (!(tw[r] in rows)) f = f " " r "-twin-names-no-row;"; else if (tier[tw[r]] == tier[r]) f = f " " r "-twin-at-same-tier;"}
      if (nc > 0) {n = 0; for (l in cl) n++; if (n < 2) f = f " crossing-rows-in-one-lane;"}
      for (id in h) if (id in u) d = d " " id
      print f "|" d }' "$T/lk" "$MAP") || { say map-dup ERROR "the map could not be parsed"; return; }
  f=${out%%|*}; d=${out#*|}
  if [ -n "$f" ]; then say map-dup FAIL "$f"; else say map-dup PASS "one row per id per tier, one success and one refusal per op above unit; DUPLICATE-CANDIDATES:${d:- none}"; fi; }

chk_landscape_scope() { oblige "$K/exclusion.$LNG" > "$T/ex" && [ -s "$T/ex" ] || { say landscape-scope ERROR "exclusion spellings empty or unreadable"; return; }
  grep -E '^[a-z][a-z0-9-]*\.[a-z]' "$LAND" > "$T/lr" 2>/dev/null; [ -s "$T/lr" ] || { say landscape-scope ERROR "no landscape rows read"; return; }
  f=$(awk -F' · ' -v exf="$T/ex" 'BEGIN {while ((getline l < exf) > 0) ex[n++] = l}
    { s = ""; k = ""; r = ""; op = ""; ru = 0
      for (i = 2; i <= NF; i++) {if ($i ~ /^surface:/) s = substr($i, 9); if ($i ~ /^kind:/) k = substr($i, 6); if ($i ~ /^ruled:/) {r = substr($i, 7); if ($i ~ /ruling:[a-z]/) ru = 1}; if ($i ~ /^op:/) op = substr($i, 4)}
      if (s == "") o = o " " $1 "-no-surface;"; if (k != "success" && k != "refusal") o = o " " $1 "-no-kind;"; if (r == "") o = o " " $1 "-no-ruled;"
      for (j = 0; j < n; j++) if (op != "" && op ~ ex[j]) o = o " " $1 "-excluded-op-" op ";"
      if (s ~ /(^| )(identity|money|consent|safety|data-lifecycle)( |$)/ && r ~ /^no/ && !ru) o = o " " $1 "-default-ruled-surface-marked-no;" }
    END {print o}' "$T/lr")
  if [ -n "$f" ]; then say landscape-scope FAIL "$f"; else say landscape-scope PASS "$(( $(wc -l < "$T/lr") )) rows carry surface, kind and ruled; no excluded op"; fi; }

chk_names() { for s in refused-names refused-id-segments refused-title-ordinals property-words violating-actions; do
    oblige "$K/$s.$LNG" > "$T/n.$s" && [ -s "$T/n.$s" ] || { say names ERROR "spelling set $s empty or unreadable"; return; }; done
  excuse "$K/name-allowlist.txt" > "$T/allow" || { say names ERROR "name-allowlist.txt unreadable"; return; }
  strip() { if [ -s "$T/allow" ]; then while IFS= read -r a; do printf 's/(^|[^A-Za-z0-9])%s([^A-Za-z0-9]|$)/\\1\\2/g\n' "$a"; done < "$T/allow" > "$T/allow.sed"; sed -E -f "$T/allow.sed"; else cat; fi; }
  { grep -oE '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*' "$LAND"; maprows; maprows | grep / | cut -d/ -f1 | sort -u; tests_all | sed -E 's|.*/||; s|\.ts$||'; lanes_all | sed -E 's|.*/||; s|\.ts$||'; } 2>/dev/null | sort -u > "$T/ids"
  tests_all | titles | sort -u > "$T/tt"
  [ -s "$T/ids" ] && [ -s "$T/tt" ] || { say names ERROR "DERIVE-FAILED: no ids or test titles read"; return; }
  cat "$T/n.refused-names" "$T/n.refused-id-segments" > "$T/pid"; cat "$T/n.refused-names" "$T/n.refused-title-ordinals" > "$T/ptt"
  { strip < "$T/ids" | grep -E -f "$T/pid" | sed 's/^/id\t/'; strip < "$T/tt" | grep -E -f "$T/ptt" | sed 's/^/title\t/'
    tests_all | while IFS= read -r f; do printf '%s\n' "$f" | titles | grep -E -f "$T/n.property-words" | while IFS= read -r t; do grep -qE -f "$T/n.violating-actions" "$f" || printf 'property\t%s\n' "$t"; done; done; } > "$T/nh"
  tk=$(maprows | grep / | cut -d/ -f1 | grep '^tier-' | tr '\n' ' ')
  [ -z "$tk" ] || { say names FAIL "lane key starts tier-: $tk"; return; }
  ratchet names "$K/names.baseline" "$T/nh" "$(( $(wc -l < "$T/ids") + $(wc -l < "$T/tt") ))"; }

chk_oracle() { oblige "$K/weak-oracle.$LNG" > "$T/wo" && [ -s "$T/wo" ] || { say oracle ERROR "refused-shape spellings unreadable"; return; }
  oblige "$K/locators.$LNG" > "$T/loc" && [ -s "$T/loc" ] || { say oracle ERROR "locator spellings empty or unreadable"; return; }
  excuse "$S/references.tsv" > "$T/refs" && [ -s "$T/refs" ] || { say oracle ERROR "references.tsv unreadable or empty"; return; }
  rf=$(sval rendered-from-paths) || { say oracle ERROR "rendered-from set undeclared"; return; }
  rows > "$T/rows" 2>/dev/null; [ -s "$T/rows" ] || { say oracle ERROR "no beats rows read"; return; }
  f=; while IFS="$TAB" read -r id p loc; do { [ -f "$p" ] && grep -qF -- "$loc" "$p"; } || f="$f reference $id does not resolve;"; done < "$T/refs"
  cut -f1 "$T/refs" | sort -u > "$T/refids"
  f="$f$(awk -F' · ' -v rf="$T/refids" -v out="$T/src" 'BEGIN {while ((getline l < rf) > 0) ok[l] = 1}
    { r = $1; src = ""; bi = ""; lb = ""; c = ""; sp = ""; d = ""; a = ""
      for (i = 2; i < NF; i++) {k = $i; sub(/:.*/, "", k); v = substr($i, length(k) + 2); if (k == "source") src = v; if (k == "breaks-if") bi = v; if (k == "live-because") lb = v; if (k == "cost_ms") c = v; if (k == "spends") sp = v; if (k == "do") d = v; if (k == "assert") a = v}
      if (src == "") o = o " " r "-no-source;"; else if (src != "literal" && src != "fixture" && src != "golden" && src !~ /^drift:/ && !(src in ok)) o = o " " r "-source-" src "-not-in-references;"
      if (bi == "") o = o " " r "-no-breaks-if;"
      if (r !~ /^tier-unit:/) {if (d == "" || a == "") o = o " " r "-no-do-or-assert;"; if (lb == "") o = o " " r "-no-live-because;"; if (c !~ /^[0-9]+$/) o = o " " r "-no-cost_ms;"; if (sp == "") o = o " " r "-no-spends;"}
      print r "\t" src > out }
    END {print o}' "$T/rows")"
  grep -E '^[a-z][a-z0-9-]*\.[a-z]' "$LAND" | grep ' · ruled:yes' | cut -d' ' -f1 | sort -u > "$T/ruled"
  sed 1d "$MAP" | sort -k1,1 | join -t "$TAB" "$T/ruled" - | cut -f2 | sort -u > "$T/rr"
  x=$(sort "$T/src" | join -t "$TAB" "$T/rr" - | while IFS="$TAB" read -r r s; do grep -qx -- "$s" "$T/refids" || printf '%s ' "$r"; done)
  [ -z "$x" ] || f="$f ruled rows without a reference source: $x;"
  case $rf in none*) ;; *) for p in $rf; do x=$(tests_all | xargs grep -lF -- "$p" 2>/dev/null | tr '\n' ' '); [ -z "$x" ] || f="$f tests read rendered-from $p: $x;"; done;; esac
  if [ -n "$f" ]; then say oracle FAIL "$f"; else say oracle PASS "$(( $(wc -l < "$T/rows") )) rows sourced, $(( $(wc -l < "$T/refs") )) references resolve, $(( $(wc -l < "$T/rr") )) ruled rows cite references"; fi; }

chk_copy() { [ -r "$S/ruled-copy.tsv" ] || { say copy ERROR "ruled-copy.tsv unreadable"; return; }
  oblige "$S/ruled-copy.tsv" > "$T/rc"; [ -s "$T/rc" ] || { say copy ERROR "registry empty without none"; return; }
  if [ "$(cat "$T/rc")" = none ]; then say copy PASS "none: no meaning-bearing copy"; return; fi
  f=; grep -vx none "$T/rc" | while IFS="$TAB" read -r key loc lit; do n=$(tests_all | xargs grep -lF -- "$lit" 2>/dev/null | wc -l); [ "$n" -eq 1 ] || printf '%s/%s pinned in %s tests;' "$key" "$loc" "$n"; done > "$T/cf"
  if [ -s "$T/cf" ]; then say copy FAIL "$(cat "$T/cf")"; else say copy PASS "$(( $(grep -cvx none "$T/rc") )) keys, each pinned in one test"; fi; }

shape_files() { case $1 in
  line-anchored-exemption) git ls-files -co --exclude-standard | grep -E "^($S/(gaps|flakes|exclusions|skip-reasons|unobservable|retired)\\.(tsv|txt)|$K/[^/]+\\.(baseline|txt))\$";;
  fail-open-verdict) scoped | grep -E '^(scripts/[^/]+\.sh|\.github/workflows/.*\.ya?ml|vitest\.config\.ts|package\.json)$';;
  unscoped-read) for t in $(sval store-sharing-tiers); do case $t in unit) scoped | grep -E '^tests/(unit|contracts)/';; hermetic) scoped | grep -E '^tests/hermetic/';; live) scoped | grep -E '^tests/live/.*\.ts$';; esac; done;;
  consuming-probe) scoped | grep -E '^(tests/live/.*\.ts|scripts/dev\.sh)$';;
  double-in-production) scoped | grep -E '^(src|hooks|tests)/.*\.ts$' | grep -v "^$(sval fakes-directory)/";;
  test-cited-by-production) scoped | grep -E '^(src/.*\.ts|hooks/.*|\.claude-plugin/.*)$';;
  second-logging-path) scoped | grep -E "$SRC";;
  machine-in-a-fixture) scoped | grep -E "^($(sval synthetic-log-fixture-directory)|$(sval goldens-directory)|tests/live/fixtures|tests/hermetic/scenarios)/";;
  *) scoped | grep -E '^tests/.*\.ts$';;
  esac; }
shape_one() { sh=$1; oblige "$K/$sh.$LNG" > "$T/sp.$sh" && [ -s "$T/sp.$sh" ] || { say "$sh" ERROR "spelling set empty or unreadable"; return; }
  [ -d "$K/corpus/$sh" ] || { say "$sh" ERROR "no planted corpus"; return; }
  for c in "$K/corpus/$sh"/*; do [ -n "$(printf '%s\n' "$c" | sigs "$T/sp.$sh")" ] || { say "$sh" FAIL "the spelling set misses its corpus form ${c##*/}"; return; }; done
  shape_files "$sh" > "$T/sf.$sh"; sigs "$T/sp.$sh" < "$T/sf.$sh" > "$T/sg.$sh" || { say "$sh" ERROR "the extractor could not read the tree"; return; }
  if [ "$sh" = tautological-oracle ]; then grep -v -E -f "$T/loc.all" "$T/sg.$sh" > "$T/sg2" || :; mv "$T/sg2" "$T/sg.$sh"; fi
  ratchet "$sh" "$K/$sh.baseline" "$T/sg.$sh" "$(( $(wc -l < "$T/sf.$sh") ))"; }
chk_refused_shapes() { oblige "$K/locators.$LNG" > "$T/loc.all" && [ -s "$T/loc.all" ] || { say refused-shapes ERROR "locator spellings unreadable"; return; }
  [ -r "$S/skip-reasons.txt" ] && [ -r "$S/unobservable.txt" ] || { say refused-shapes ERROR "skip-reasons or unobservable unreadable"; return; }
  : > "$T/rs"; for sh in $SHAPES; do ( shape_one "$sh" ) >> "$T/rs"; done
  e=$(grep ' ERROR ' "$T/rs" | sed 's/^CHECK //' | tr '\n' ';'); fl=$(grep ' FAIL ' "$T/rs" | sed 's/^CHECK //' | tr '\n' ';')
  np=$(( $(grep -c ' PASS ' "$T/rs") ))
  if [ -n "$e" ]; then say refused-shapes ERROR "$e $fl"; elif [ -n "$fl" ]; then say refused-shapes FAIL "$fl"
  else say refused-shapes PASS "$np shapes, each corpus caught, none beyond baseline"; fi; }

chk_gaps() { excuse "$S/gaps.tsv" > "$T/g" || { say gaps ERROR "gaps.tsv unreadable"; return; }
  excuse "$S/roster.txt" > "$T/ro" && [ -s "$T/ro" ] || { say gaps ERROR "roster unreadable or empty"; return; }
  [ -n "$OWN_IDS" ] || { say gaps ERROR "own identifiers undeclared"; return; }
  maprows > "$T/MR"
  f=$(awk -F'\t' -v d="$TODAY" -v own="$OWN_IDS" -v rof="$T/ro" -v mrf="$T/MR" 'BEGIN {while ((getline l < rof) > 0) ro[l] = 1; while ((getline l < mrf) > 0) mr[l] = 1}
    NF {if (NF < 5) {o = o " " $1 "-malformed;"; next}; if (!($1 in mr)) o = o " " $1 "-unmapped;"; if (!($4 in ro)) o = o " " $1 "-owner-not-in-roster;"; if ($5 < d) o = o " " $1 "-expired;"; if ($3 ~ own) o = o " " $1 "-waits-on-own-backlog;"}
    END {print o}' "$T/g")
  if [ -n "$f" ]; then say gaps FAIL "$f"; else say gaps PASS "$(( $(wc -l < "$T/g") )) gaps, each owned, unexpired and external"; fi; }

wall_of() { awk -F'\t' -v k="$1" '$1 == k && NF >= 2 && k !~ /^tier-/ {w = $2 * 1000; f = 1} k ~ /^tier-/ && index($1, k ":") == 1 {w += $7; f = 1} END {if (!f) exit 1; print int(w)}' "$2"; }
chk_budgets() { excuse "$S/budgets.tsv" > "$T/b" || { say budgets ERROR "budgets.tsv unreadable"; return; }
  th=$(value target-hermetic-ms) && tl=$(value target-live-sequence-ms) && hp=$(value budget-headroom-pct) && value target-unit-ms > /dev/null || { say budgets ERROR "speed targets undeclared"; return; }
  rows > "$T/rows" 2>/dev/null; [ -s "$T/rows" ] || { say budgets ERROR "no beats rows read"; return; }
  awk -F' · ' '$1 !~ /^tier-unit:/ {k = ($1 ~ /^tier-hermetic:/) ? "tier-hermetic" : substr($1, 1, index($1, "/") - 1); for (i = 2; i <= NF; i++) if ($i ~ /^cost_ms:/) c[k] += substr($i, 9)} END {for (k in c) print k "\t" c[k]}' "$T/rows" | sort > "$T/paper"
  hm=$(awk -F'\t' '$1 == "tier-hermetic" {print $2}' "$T/paper"); lv=$(awk -F'\t' '$1 !~ /^tier-/ {s += $2} END {print s + 0}' "$T/paper"); f=
  [ $(( ${hm:-0} * (100 + hp) / 100 )) -le "$th" ] || f="$f hermetic paper cost ${hm}ms with headroom above $th;"
  [ $(( lv * (100 + hp) / 100 )) -le "$tl" ] || f="$f live sequence paper cost ${lv}ms with headroom above $tl;"
  { echo tier-unit; cut -f1 "$T/paper"; } | sort -u > "$T/keys"; cut -f1 "$T/b" | sort -u > "$T/pinned"
  un=$(comm -23 "$T/keys" "$T/pinned" | tr '\n' ' ')
  if [ "$MODE" != plain ]; then [ -z "$un" ] || f="$f BUDGET-UNPINNED: $un;"; sp=0
    while IFS="$TAB" read -r key pin ids load; do n=0; : > "$T/w"
      for id in $(printf '%s' "$ids" | tr ',' ' '); do l="$RUNS/$id.ledger"; [ -r "$l" ] || { say budgets ERROR "run $id unreadable"; return; }
        grep -q "^command: .*--canonical\\|^mode: sequence\\|^mode: tier" "$l" && wall_of "$key" "$l" >> "$T/w" && n=$((n + 1)); done
      [ "$n" -ge 3 ] || { f="$f $key pinned from $n green canonical runs;"; continue; }
      mx=$(sort -n "$T/w" | tail -n 1); md=$(sort -n "$T/w" | awk '{a[NR] = $1} END {print a[int((NR + 1) / 2)]}')
      [ $(( mx * (100 + hp) / 100 )) -le "$pin" ] || f="$f $key max ${mx}ms with headroom above pin $pin;"
      [ "$mx" -le $(( md * 2 )) ] || f="$f $key slowest ${mx}ms over twice the median ${md}ms;"
      case $key in tier-*) ;; *) sp=$((sp + pin));; esac
      old=$(git show "$MB:$S/budgets.tsv" 2>/dev/null | awk -F'\t' -v k="$key" '$1 == k {print $2}')
      if [ -n "$old" ] && [ "$pin" -gt "$old" ]; then add=$(awk -F' · ' -v k="$key" 'index($1, k) == 1 {for (i = 2; i <= NF; i++) if ($i ~ /^cost_ms:/ && substr($i, 9) + 0 > m) m = substr($i, 9) + 0} END {print m + 0}' "$T/rows")
        [ $((pin - old)) -le "$add" ] || f="$f $key pin raised by $((pin - old))ms, above the added rows' max ${add}ms;"; fi
    done < "$T/b"; [ "$sp" -le "$tl" ] || f="$f sequence pin ${sp}ms above target $tl;"; fi
  if [ -n "$f" ]; then say budgets FAIL "$f"; else say budgets PASS "paper: live ${lv}ms and hermetic ${hm:-0}ms within targets at ${hp}% headroom; unpinned: ${un:-none}"; fi; }

chk_collected() { ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null > "$T/ci"; [ -s "$T/ci" ] || { say collected ERROR "CI config unreadable: no .github/workflows"; return; }
  xargs grep -l -e 'suite-checks.sh --close' < "$T/ci" > /dev/null 2>&1 || { say collected ERROR "no CI job invokes scripts/suite-checks.sh --close"; return; }
  bl=$(sval blocking-log) && [ -r "$bl" ] || { say collected ERROR "blocking log unreadable"; return; }
  sval test-name-pattern > /dev/null && sval lane-file-pattern > /dev/null || { say collected ERROR "no test-name or lane pattern declared"; return; }
  tests_all > "$T/tf"; [ -s "$T/tf" ] || { say collected ERROR "zero test files matched"; return; }
  x=$(while IFS= read -r t; do grep -qF -- "$t" "$bl" || printf '%s ' "$t"; done < "$T/tf")
  if [ -n "$x" ]; then say collected FAIL "TIER-UNCOLLECTED: $x"; else say collected PASS "$(( $(wc -l < "$T/tf") )) test files collected by the blocking command"; fi; }

chk_self_tests() { bl=$(sval blocking-log) && [ -r "$bl" ] || { say self-tests ERROR "census unreadable: the blocking log is absent"; return; }
  oblige "$S/self-tests.txt" > "$T/st" && [ -s "$T/st" ] || { say self-tests ERROR "self-tests.txt unreadable or empty"; return; }
  x=$(cut -f3 "$T/st" | while IFS= read -r t; do grep -qF -- "$t" "$bl" || printf '%s ' "$t"; done)
  y=$(for c in map-ids map-beats map-names map-dup landscape-scope names oracle copy refused-shapes gaps budgets collected self-tests retired env-twice bare-doors clones size tree observed bite flakes; do
    awk -F'\t' -v c="$c" '$1 == c && $2 == "planted" {p = 1} $1 == c && $2 != "planted" && $2 != "law" {e = 1} END {exit !(p && e)}' "$T/st" || printf '%s ' "$c"; done)
  if [ -n "$x$y" ]; then say self-tests FAIL "${x:+not in the census: $x}${y:+ checks without a could-not-look and a planted case: $y}"
  else say self-tests PASS "$(( $(wc -l < "$T/st") )) self-tests in the census"; fi; }

chk_retired() { oblige "$K/assertions.$LNG" > "$T/as" && [ -s "$T/as" ] || { say retired ERROR "assertion set empty or unreadable"; return; }
  excuse "$S/retired.tsv" > "$T/ret" || { say retired ERROR "retired.tsv unreadable"; return; }
  mkdir "$T/mb" && git ls-tree -r --name-only "$MB" -- tests | grep -E '\.ts$' > "$T/mbf" || :
  while IFS= read -r f; do mkdir -p "$T/mb/${f%/*}" && git show "$MB:$f" > "$T/mb/$f" || { say retired ERROR "merge base file $f unreadable"; return; }; done < "$T/mbf"
  sed "s|^|$T/mb/|" "$T/mbf" | sigs "$T/as" | sort > "$T/old" || { say retired ERROR "the extractor could not read the merge base"; return; }
  git ls-files -co --exclude-standard -- tests | grep -E '\.ts$' | sigs "$T/as" | sort > "$T/new" || { say retired ERROR "the extractor could not read the tree"; return; }
  comm -23 "$T/old" "$T/new" | sed "s/$TAB/ · /" | sort > "$T/gone"; cut -f2 "$T/ret" | sort > "$T/rsig"
  x=$(comm -23 "$T/gone" "$T/rsig" | tr '\n' ';'); y=$(awk -F'\t' 'NF && ($3 == "" || $4 == "") {printf "%s ", $2}' "$T/ret")
  if [ -n "$x$y" ]; then say retired FAIL "${x:+retired without a ledger row: $x}${y:+ rows without disposition or run: $y}"
  else say retired PASS "$(( $(wc -l < "$T/old") )) assertions at the merge base, $(( $(wc -l < "$T/gone") )) retired, each ledgered"; fi; }

leg() { for l in $(led); do grep -qx "mode: $1" "$l" && printf '%s %s\n' "$(git log -1 --format=%ct -- "$l" 2>/dev/null)" "$l"; done | sort -n | tail -n 1; }
chk_env_twice() { { scoped | grep -E "$SRC" | xargs grep -ohE "env\\.get\\('[A-Z_]+'\\)" | sed -E "s/.*\\('//; s/'\\)//"
    node -e 'for (const k of Object.keys(require("./.claude-plugin/plugin.json").userConfig || {})) console.log(k)'; } 2>/dev/null | sort -u > "$T/keys"
  [ -s "$T/keys" ] || { say env-twice ERROR "key set unreadable"; return; }
  tp=$(sval double-run-trigger-paths) && [ -n "$tp" ] || { say env-twice ERROR "trigger paths unreadable"; return; }
  w=$(value schedule-window-days) || { say env-twice ERROR "schedule window undeclared"; return; }
  landed=$(git log --diff-filter=A --format=%ct -- scripts/suite-checks.sh 2>/dev/null | tail -n 1)
  b=$(leg env-base); p=$(leg env-perturbed); bt=${b%% *}; pt=${p%% *}
  if [ -z "$b" ] || [ -z "$p" ]; then
    if [ -z "$landed" ] || [ $((NOW - landed)) -lt $((w * 86400)) ]; then say env-twice PASS "not-due: $(( $(wc -l < "$T/keys") )) keys, first window open"; else say env-twice ERROR "a leg is missing"; fi; return; fi
  last=$bt; [ "$pt" -le "$bt" ] || last=$pt; [ $((NOW - last)) -le $((w * 86400)) ] || { say env-twice ERROR "the last leg is older than $w days"; return; }
  f=; x=$(while IFS= read -r k; do grep '^config:' "${p#* }" | grep -qF -- "$k" || printf '%s ' "$k"; done < "$T/keys"); [ -z "$x" ] || f="$f keys not flipped: $x;"
  awk -F'\t' 'NF >= 2 && $1 !~ /:$/ {print $1 "\t" $2}' "${b#* }" | sort > "$T/vb"; awk -F'\t' 'NF >= 2 && $1 !~ /:$/ {print $1 "\t" $2}' "${p#* }" | sort > "$T/vp"
  cmp -s "$T/vb" "$T/vp" || f="$f verdicts differ between legs;"
  ch=$({ git diff --name-only "$MB"; git ls-files -o --exclude-standard; } | while IFS= read -r c; do for t in $tp; do [ "$c" != "$t" ] || printf '%s ' "$c"; done; done)
  st=$(subject_tree) || { say env-twice ERROR "subject tree unreadable"; return; }
  [ -z "$ch" ] || grep -qx "tree-start: $st" "${p#* }" || f="$f trigger paths changed ($ch), double run owed on this subject;"
  if [ -n "$f" ]; then say env-twice FAIL "$f"; else say env-twice PASS "not-due ${p##*/}: $(( $(wc -l < "$T/keys") )) keys flipped, legs agree"; fi; }

chk_bare_doors() { oblige "$K/doors.$LNG" > "$T/spell" && [ -s "$T/spell" ] || { say bare-doors ERROR "door spellings empty or unreadable"; return; }
  scoped | grep -E "$SRC" > "$T/src"; n=$(( $(wc -l < "$T/src") ))
  extract_doors < "$T/src" > "$T/doors" || { say bare-doors ERROR "the extractor could not read the tree"; return; }
  ratchet bare-doors "$K/bare-doors.baseline" "$T/doors" "$n"; }

chk_clones() { d=node_modules/.bin/jscpd; [ -x "$d" ] || { say clones ERROR "detector absent: $d"; return; }
  th=$(value clone-threshold-tokens) || { say clones ERROR "clone threshold undeclared"; return; }
  scoped | grep -E '^(src|hooks|tests)/.*\.ts$' > "$T/cf"; n=$(( $(wc -l < "$T/cf") ))
  [ "$n" -gt 0 ] || { say clones ERROR "zero items scanned"; return; }
  "$d" --min-tokens "$th" --reporters json --output "$T/jscpd" --silent $(cat "$T/cf") > "$T/jout" 2>&1 || { say clones ERROR "jscpd failed: $(tail -n 1 "$T/jout")"; return; }
  [ -r "$T/jscpd/jscpd-report.json" ] || { say clones ERROR "the detector matched no files"; return; }
  node -e 'const r = require(process.argv[1]); for (const d of r.duplicates || []) console.log("clone\t" + d.fragment.split("\n")[0].trim().replace(/\s+/g, " "))' "$T/jscpd/jscpd-report.json" > "$T/cl" || { say clones ERROR "report unparseable"; return; }
  ratchet clones "$K/clones.baseline" "$T/cl" "$n"; }

chk_size() { c=$(value size-ceiling) || { say size ERROR "size-ceiling undeclared"; return; }
  scoped | grep -E '^tests/.*\.ts$' > "$T/zf"; n=$(( $(wc -l < "$T/zf") )); [ "$n" -gt 0 ] || { say size ERROR "zero items scanned"; return; }
  x=$(while IFS= read -r f; do l=$(( $(wc -l < "$f") )); [ "$l" -le "$c" ] || printf '%s has %s lines; ' "$f" "$l"; done < "$T/zf")
  if [ -n "$x" ]; then say size FAIL "above $c: $x"; else say size PASS "$n test files at or under $c lines"; fi; }

canon() { st=$(subject_tree) || return 2; sd=$(subject_dirty); for l in $(led); do
  awk -F': ' -v t="$st" -v d="$sd" '$1 == "mode" && ($2 == "sequence" || $2 == "tier") {m = 1} $1 == "tree-start" && $2 == t {a = 1} $1 == "tree-end" && $2 == t {b = 1} $1 ~ /^dirty-start:?$/ && $2 == d {c = 1} $1 ~ /^dirty-end:?$/ && $2 == d {e = 1} END {exit !(m && a && b && c && e)}' "$l" && printf '%s\n' "$l"; done; }
chk_tree() { canon > "$T/canon" || { say tree ERROR "subject tree unreadable"; return; }
  [ -s "$T/canon" ] || { say tree ERROR "no ledger for this subject"; return; }
  xargs grep -lx 'mode: sequence' < "$T/canon" > /dev/null 2>&1 || { say tree ERROR "no full sequence ledger for this subject"; return; }
  say tree PASS "$(( $(wc -l < "$T/canon") )) ledgers bound to this subject"; }
chk_observed() { canon > "$T/canon" && [ -s "$T/canon" ] || { say observed ERROR "LOG-ABSENT: no canonical ledger"; return; }
  xargs cat < "$T/canon" | awk -F'\t' 'NF >= 8' > "$T/lrows"
  grep -E '^[a-z][a-z0-9-]*\.[a-z]' "$LAND" | awk -F' · ' '{op = ""; for (i = 2; i <= NF; i++) {if ($i ~ /^op:/) op = substr($i, 4); if ($i ~ /^evidence:/) op = $i} print $1 "\t" op}' > "$T/lop"
  f=$(awk -F'\t' 'FILENAME == ARGV[1] {op[$1] = $2; next} FILENAME == ARGV[2] {v[$1] = $2; a[$1] = $3; o[$1] = $5; g[$1] = $6; next} FNR == 1 {next}
    { id = $1; r = $2; t = (r ~ /^tier-/)
      if (!(r in v)) {x = x " " (t ? "TIER-UNCOLLECTED:" : "CLAIMED-NOT-INVOKED:") r ";"; next}
      if (v[r] != "pass" && v[r] != "✓") {x = x " " (t ? "TIER-NOT-RUN:" : "NOT-PASSED:") r ";"; next}
      if (op[id] ~ /^evidence:/) {if (index(g[r], substr(op[id], 10)) == 0) x = x " UNOBSERVED:" r "/" id ";"}
      else if (("," o[r] ",") !~ ("," op[id] ",")) x = x " UNOBSERVED:" r "/" id ";"
      if (index("," a[r], "," id "=") == 0) x = x " NO-ASSERTION:" r "/" id ";" }
    END {print x}' "$T/lop" "$T/lrows" "$MAP")
  y=$(maprows | grep '^tier-' | while IFS= read -r r; do grep -q "^$r$TAB" "$S/bites.tsv" || printf 'TIER-NO-BITE:%s ' "$r"; done)
  if [ -n "$f$y" ]; then say observed FAIL "$f $y"; else say observed PASS "$(( $(maprows | wc -l) )) mapped rows observed under their own ids"; fi; }
chk_bite() { excuse "$S/bites.tsv" > "$T/bt" || { say bite ERROR "bites.tsv unreadable"; return; }
  maprows > "$T/MR"; [ -s "$T/MR" ] || { say bite ERROR "no map rows read"; return; }
  x=$(while IFS= read -r r; do ln=$(awk -F'\t' -v r="$r" '$1 == r' "$T/bt" | head -n 1); [ -n "$ln" ] || { printf 'unbitten:%s ' "$r"; continue; }
    fl=$(printf '%s' "$ln" | cut -f2); dh=$(printf '%s' "$ln" | cut -f3); ri=$(printf '%s' "$ln" | cut -f4)
    ids=$(awk -F'\t' -v r="$r" '$2 == r {print $1}' "$MAP"); ok=
    for id in $ids; do lf=$(grep "^$id · " "$LAND" | awk -F' · ' '{print $NF}'); [ "${fl%%:*}" != "${lf%%:*}" ] && [ "${fl%%:*}" != "$HOOK" ] || ok=1; done
    [ -n "$ok" ] || printf 'bite-outside-capability:%s ' "$r"; [ -n "$dh" ] || printf 'no-diff-hash:%s ' "$r"
    [ -r "$RUNS/$ri.ledger" ] && awk -F'\t' -v r="$r" '$1 == r && $2 != "pass" && $2 != "✓" {f = 1} END {exit !f}' "$RUNS/$ri.ledger" || printf 'red-run-absent:%s ' "$r"
  done < "$T/MR")
  if [ -n "$x" ]; then say bite FAIL "$x"; else say bite PASS "$(( $(wc -l < "$T/MR") )) rows bitten inside their capability"; fi; }
chk_flakes() { excuse "$S/flakes.tsv" > "$T/fk" || { say flakes ERROR "flakes.tsv unreadable"; return; }
  n=$(( $(grep -c . "$T/fk") ))
  if [ "$n" -gt 0 ]; then say flakes FAIL "$n flakes open at close: $(cut -f1 "$T/fk" | tr '\n' ' ')"; else say flakes PASS "no flake open"; fi; }

run() { for r; do f=chk_$(printf '%s' "$r" | tr - _); case $(command -v "$f") in "$f") "$f";; *) say "$r" ERROR "not adapted: no $f";; esac; done; }
run map-ids map-beats map-names map-dup landscape-scope names oracle copy refused-shapes gaps budgets collected self-tests retired env-twice bare-doors clones size
[ "$MODE" = plain ] || run tree observed bite flakes
exit "$rc"
