import { parseFrontmatter } from './frontmatter.ts';
import { parseLimit } from './limits.ts';

export type AgentFs = {
  exists: (path: string) => Promise<boolean>;
  read: (path: string) => Promise<string>;
  /** File names (no directory part) of the `.md` files in a directory. */
  listMarkdown: (dir: string) => Promise<string[]>;
};

export type AgentLimit = {
  limit: number;
  /** The definition file the limit came from, or `default`. */
  source: string;
};

function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

/**
 * Resolves an agent type to its compact point: `<dir>/<type>.md` in each
 * directory in order, then any file whose frontmatter `name:` is the type
 * (the directories scanned once), else the default. Every failure is logged
 * and falls back to the default; results are cached per type.
 */
export class AgentLimits {
  private readonly byType = new Map<string, Promise<AgentLimit>>();
  private nameIndex: Promise<Map<string, string>> | undefined;

  constructor(
    private readonly dirs: readonly string[],
    private readonly fallback: number,
    private readonly fs: AgentFs,
    private readonly log: (line: string) => void,
  ) {}

  resolve(type: string): Promise<AgentLimit> {
    let hit = this.byType.get(type);
    if (!hit) {
      hit = this.lookup(type);
      this.byType.set(type, hit);
    }
    return hit;
  }

  private async lookup(type: string): Promise<AgentLimit> {
    for (const dir of this.dirs) {
      const path = join(dir, `${type}.md`);
      let found = false;
      try {
        found = await this.fs.exists(path);
      } catch (error) {
        this.log(`sub-agent-compact: checking ${path} failed: ${String(error)}`);
      }
      if (found) {
        const fields = await this.fields(path);
        if (fields && (!fields.name || fields.name === type)) return this.fromFields(type, path, fields);
      }
    }
    const byName = (await this.index()).get(type);
    if (byName) {
      const fields = await this.fields(byName);
      if (fields) return this.fromFields(type, byName, fields);
    }
    return { limit: this.fallback, source: 'default' };
  }

  private fromFields(type: string, path: string, fields: Record<string, string>): AgentLimit {
    const raw = fields.autoCompact;
    if (raw === undefined || raw === '') return { limit: this.fallback, source: 'default' };
    const parsed = parseLimit(raw);
    if (parsed.ok) return { limit: parsed.value, source: path };
    this.log(`sub-agent-compact: ${path} autoCompact for ${type} is invalid (${parsed.error}); using the default ${this.fallback}`);
    return { limit: this.fallback, source: 'default' };
  }

  private async fields(path: string): Promise<Record<string, string> | undefined> {
    try {
      return parseFrontmatter(await this.fs.read(path));
    } catch (error) {
      this.log(`sub-agent-compact: reading ${path} failed: ${String(error)}`);
      return undefined;
    }
  }

  private index(): Promise<Map<string, string>> {
    this.nameIndex ??= (async () => {
      const names = new Map<string, string>();
      for (const dir of this.dirs) {
        let files: string[] = [];
        try {
          if (!(await this.fs.exists(dir))) continue;
          files = await this.fs.listMarkdown(dir);
        } catch (error) {
          this.log(`sub-agent-compact: listing ${dir} failed: ${String(error)}`);
          continue;
        }
        for (const file of files) {
          const path = join(dir, file);
          const name = (await this.fields(path))?.name;
          if (name && !names.has(name)) names.set(name, path);
        }
      }
      return names;
    })();
    return this.nameIndex;
  }
}
