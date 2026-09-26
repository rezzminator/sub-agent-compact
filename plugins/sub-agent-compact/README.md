# sub-agent-compact

Smart auto-compact for Claude Code. Every sub-agent gets its own compaction point, and the model compacts itself at a milestone it chooses.

Configure it per agent in frontmatter:

```yaml
autoCompact:
  forceAt: 60%      # compaction is forced here
  nudgeFrom: 20%    # the first nudge to wrap up and compact
  nudgeEvery: 10%   # a nudge every 10% after that
  enabled: true
```

It requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. The full documentation, the benchmark and the options live in the repository: https://github.com/rezzminator/sub-agent-compact

Built and maintained with [Professor](https://github.com/rezzminator/professor).
