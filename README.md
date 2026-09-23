# Claude Skills for Zed

Autocomplete, documentation on hover, and validation for Claude Code `SKILL.md` files.

For those of us still writing code by hand, this package aims to make skill development for Claude a little less painful.

Features:

- **Completion** for every frontmatter key and its accepted values, including the real built-in tool
  list for `allowed-tools`.
- **Hover** showing the official docs for a field, with its constraints and a link.
- **Diagnostics** for unknown keys, wrong types, out-of-range values, and fields that silently have
  no effect.

## Install

Not yet published so installing is a semi-manual process for now.

### With Claude Code

```bash
git clone https://github.com/dontfeedthecode/cc-zed-lsp && cd cc-zed-lsp
claude "/setup-zed"
```

The bundled `/setup-zed` skill builds the server and adds it to `~/.config/zed/settings.json`. To
set it up for one project only, pass that project's path: `/setup-zed /path/to/project`. It then
lists the two steps that have to happen in Zed: **zed: install dev extension** (first time only)
and **editor: restart language server**. Run it again after a `git pull` to rebuild.

### By hand

**1. Build the server.**

```bash
git clone https://github.com/dontfeedthecode/cc-zed-lsp && cd cc-zed-lsp
npm ci && npm run build
rustup target add wasm32-wasip2
```

**2. Install the extension.** In Zed: command palette → **zed: install dev extension** → select the
`extension/` directory. Zed compiles it to WebAssembly itself; this takes a minute the first time.

**3. Point it at your build.** Without this the extension tries to install
`@thecode/claude-skills-lsp` from npm, which does not exist yet, and the server never starts. In the
project where you want skill support, create `.zed/settings.json`:

```json
{
  "lsp": {
    "claude-skills-lsp": {
      "binary": {
        "path": "/ABSOLUTE/PATH/TO/cc-zed-lsp/packages/server/dist/server.js",
        "arguments": ["--stdio"]
      }
    }
  }
}
```

Use a real absolute path — `~` and relative paths are not expanded. To get skill support in *every*
project rather than one, put the same `lsp` block in `~/.config/zed/settings.json` instead.

**Check it worked.** Open `fixtures/demo-skill/SKILL.md` from this repo. Four of its frontmatter
lines should be underlined, and completion after `effort: ` should offer five levels. If nothing
happens, **dev: open language server logs** will say why.

Once the packages are published, steps 1 and 3 go away: the extension installs its own server.

## It attaches to all Markdown. Here's how to turn it off.

Zed attaches language servers to *languages*, not filenames, and there is no narrower hook that
keeps markdown preview working. So this server starts for any project containing Markdown — and
then **gates by path**, returning nothing at all for files that aren't skills. Your README gets no
diagnostics and no completions.

If you'd still rather it not start everywhere, disable it globally in `~/.config/zed/settings.json`:

```json
{ "languages": { "Markdown": { "language_servers": ["!claude-skills-lsp", "..."] } } }
```

and re-enable it per project in `<project>/.zed/settings.json`:

```json
{ "languages": { "Markdown": { "language_servers": ["claude-skills-lsp", "..."] } } }
```

## Configuration

Under `lsp.claude-skills-lsp.initialization_options.claudeSkills`:

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Turn the server off without uninstalling. |
| `reportUndocumented` | `true` | Hint at real-but-undocumented keys such as `version`. |
| `portability` | `false` | Also flag keys rejected outside Claude Code (claude.ai uploads, the Skills API). Useful for a skill you intend to publish. |
| `include` / `exclude` | `[]` | Globs, for unconventional layouts. |

## What it checks

Severities are chosen so the squiggles stay worth reading. Unrecognised keys are **warnings**, never
errors — a third of the skills shipped in the official plugin marketplace use a key the docs don't
list, and erroring on those would train you to ignore everything else.

| Check | Severity |
| --- | --- |
| Opening `---` not on line 1 — the entire file becomes skill content | Error |
| Unterminated frontmatter, invalid YAML, duplicate key | Error |
| Value outside a documented enum; non-boolean in a boolean field | Error |
| `compatibility` over its documented 500-character limit | Error |
| `agent:` or `background:` without `context: fork` — silently inert | Warning |
| `description` + `when_to_use` over the 1,536-character listing cap | Warning |
| Unknown key, with a did-you-mean | Warning |
| `tools:` in a skill — that's subagent frontmatter, you want `allowed-tools:` | Warning |
| `name` not kebab-case, or over 64 characters | Warning |
| `model:` without `context: fork` | Hint — see below |
| Keys Claude Code ignores (`version`, `author`, …) | Hint |

Skills under `skills/synced/` are skipped entirely: they're regenerated from your claude.ai account,
so anything flagged there is both un-actionable and guaranteed to come back.

`model:` without `context: fork` is a **hint rather than a warning on purpose.** The docs say the
override "applies for the rest of the current turn", implying no fork is needed; observed behaviour
reported elsewhere says otherwise. Until that's settled, the tool surfaces the ambiguity instead of
asserting either way.

## How the schema stays current

`packages/docs-sync` fetches the published docs and generates
`packages/schema/src/generated/docs-extract.json` — field names, whether each is required, and the
description prose used verbatim for hover. A hand-curated layer in `packages/schema/src/curated/`
supplies what the docs express only as prose: types, enums, limits and cross-field rules.

Enums are **never** parsed out of prose. The phrasing varies per field, and `model:` says only
"accepts the same values as `/model`", which no parser can turn into a list. Instead the generator
extracts every backticked token in each description and the drift checker compares that set against
the curated enums:

```bash
npm run docs:check   # HARD drift fails CI, SOFT drift opens a PR
```

- A curated value that vanishes upstream → **hard failure**, triage required.
- A new token appearing in a field we've curated → **soft**, worth a look.
- A page that stops looking like a docs page (404, wrong content type, missing table) → **refuses to
  regenerate**, so a docs redesign leaves you stale but correct rather than silently empty.

## Development

```bash
npm test                 # 71 tests: rules, cursor resolution, LSP integration, packaging
npm run check:versions   # extension and server versions must agree exactly
```

The server and the extension pin the same version deliberately. They share an interface that isn't
LSP, and Zed registry updates take days, so a floating server could break users the moment it's
published with no way to hot-fix.

Iterating: copy `.zed/settings.json.example` to `.zed/settings.json`, point it at your local
`packages/server/dist/server.js`, and the extension will run that instead of the published package.
Rebuild the server and run **editor: restart language server** — about a second, no WASM rebuild.
Changes to `extension/` need **zed: rebuild dev extension**. LSP traffic is visible under **dev: open
language server logs**.

### Layout

```
packages/schema/      Pure: types, curated facts, rules, validation. No LSP, no fs, no network.
packages/server/      The language server. Bundles schema into one zero-dependency file.
packages/docs-sync/   Fetches the docs, generates the extract, classifies drift.
extension/            The Zed extension (Rust → wasm32-wasip2).
.claude/skills/       /setup-zed: builds the server and points Zed at it.
```

`packages/schema` is deliberately dependency-free so it can also back a CLI linter or a GitHub
Action later. The rule that keeps new artifact types cheap: the feature layer speaks only
`FieldSpec`, so there is no `if (field.name === 'effort')` anywhere outside `curated/`.

## Roadmap

Phase 1 is skills. Agents, slash commands and output styles are each one docs source, one curated
field file and one path matcher — no changes to completion, hover or diagnostics.

`.claude/settings.json` and `plugin.json` are JSON, so they'll be served by generated JSON Schemas
registered with SchemaStore rather than by this server: zero configuration, every editor, a tenth of
the work.

## License

MIT
