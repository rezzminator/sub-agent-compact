/**
 * Reads the top-level scalar keys of a markdown file's leading YAML
 * frontmatter (`---` ... `---`). Nested values, lists and block scalars are
 * skipped; only `key: value` lines at column 0 are read. No frontmatter → {}.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const fields: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') return fields;
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[2] ?? '').trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    fields[match[1] as string] = value;
  }
  return {}; // unterminated: not frontmatter
}
