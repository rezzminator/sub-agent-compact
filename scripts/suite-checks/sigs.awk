# sigs.awk -v pats=<spelling set> <files>: one "<enclosing symbol>TAB<normalised statement>" per line matching a spelling
# the signature never names the file or the line, so a baseline survives a move; an empty spelling set exits 3
BEGIN {
  while ((getline l < pats) > 0) if (l !~ /^#/ && l != "") p[n++] = l
  close(pats)
  if (n == 0) { bad = 1; exit 3 }
}
FNR == 1 { sym = "<top>" }
{
  line = $0
  if (match(line, /^[ \t]*(export[ \t]+)?(default[ \t]+)?(async[ \t]+)?function[ \t]*[*]?[ \t]*[A-Za-z_$][A-Za-z0-9_$]*/)) { s = substr(line, RSTART, RLENGTH); sub(/.*function[ \t]*[*]?[ \t]*/, "", s); sym = s }
  else if (match(line, /^[ \t]*(export[ \t]+)?(const|let|var)[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=[ \t]*(async[ \t]*)?([(]|function|[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=>)/)) { s = line; sub(/^[ \t]*(export[ \t]+)?(const|let|var)[ \t]+/, "", s); sub(/[^A-Za-z0-9_$].*/, "", s); sym = s }
  else if (match(line, /(^|[^A-Za-z0-9_.])(describe|it|test)([.]each[(][^)]*[)])?[(][ \t]*['"`][^'"`]+/)) { s = substr(line, RSTART, RLENGTH); sub(/^[^'"`]*['"`]/, "", s); sym = s }
  else if (match(line, /^[a-z][a-z0-9_]*[(][)][ \t]*[{]/)) { s = line; sub(/[(].*/, "", s); sym = s }
  for (i = 0; i < n; i++) if (line ~ p[i]) {
    st = line; gsub(/[ \t]+/, " ", st); sub(/^ /, "", st); sub(/ $/, "", st)
    print sym "\t" st
    break
  }
}
END { if (bad) exit 3 }
