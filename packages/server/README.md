# @thecode/claude-skills-lsp

Language server for Claude Code `SKILL.md` files: completion, documentation on hover, and
validation of frontmatter.

The Claude Code skill format is specified only as prose, with no schema and no validator, so
frontmatter mistakes are silent. This server catches them: unknown keys, wrong types, values
outside a documented enum, and fields that only work alongside another one.

It is the server half of the [Claude Skills extension for Zed][repo]. It speaks plain LSP over
stdio, so any LSP-capable editor can drive it.

## Usage

```bash
npx @thecode/claude-skills-lsp --stdio
```

In Zed, install the **Claude Skills** extension instead — it manages this package for you.

## Configuration

Sent as LSP `initializationOptions` under a `claudeSkills` key:

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Turn the server off without uninstalling. |
| `reportUndocumented` | `true` | Hint at real-but-undocumented keys such as `version`. |
| `portability` | `false` | Also flag keys rejected outside Claude Code. |
| `include` / `exclude` | `[]` | Globs, for unconventional layouts. |

The server attaches to Markdown but **gates by path**: it returns nothing at all for files that
aren't skills, so your README gets no diagnostics and no completions.

Full documentation, including what each check flags and why, is in the [repository][repo].

[repo]: https://github.com/dontfeedthecode/cc-zed-lsp

## License

MIT © Tim Sheehan
