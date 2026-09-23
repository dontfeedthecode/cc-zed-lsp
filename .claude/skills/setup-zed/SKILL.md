---
name: setup-zed
description: Build the Claude Skills language server from this checkout and point Zed at it. Run after cloning, and again after pulling changes.
argument-hint: "[global | /path/to/project]"
arguments: target
disable-model-invocation: true
allowed-tools: Bash(node --version) Bash(which node) Bash(npm ci) Bash(npm run build) Bash(rustup target add wasm32-wasip2) Bash(pwd) Read Edit Write
---

Set up this repository's language server for Zed. Work through the steps in order and stop at the first failure, reporting the exact error.

## 1. Check prerequisites

Run `node --version`. Node 20 or newer is required. If it is missing or older, stop and say so.

Run `which node` and keep the absolute path it prints. Step 3 needs it.

## 2. Build the server

Run from the repository root (`${CLAUDE_PROJECT_DIR}`):

1. `npm ci`
2. `npm run build`
3. `rustup target add wasm32-wasip2`. Zed needs this target to compile the extension. If `rustup` is not installed, don't stop: tell the user to install Rust from https://rustup.rs before step 4.

Confirm that `${CLAUDE_PROJECT_DIR}/packages/server/dist/server.js` now exists.

## 3. Point Zed at the build

Choose the settings file from `$target`:

- empty or `global`: `~/.config/zed/settings.json`, so skill support works in every project. This is the default.
- a directory path: `<that path>/.zed/settings.json`, for that project only.

Merge this block into the file. Use real absolute paths, because Zed does not expand `~` or relative paths:

```json
"lsp": {
  "claude-skills-lsp": {
    "binary": {
      "path": "<NODE PATH FROM STEP 1>",
      "arguments": ["<ABSOLUTE REPO PATH>/packages/server/dist/server.js", "--stdio"]
    }
  }
}
```

`path` must be Node, not `server.js`. Zed runs `binary.path` itself without going through the extension, and `server.js` is not executable, so pointing `path` at it fails with a spawn error.

Zed settings files are JSON with comments and trailing commas, so edit them in place. Never rewrite one through a JSON parser, because that strips the user's comments.

- If the file does not exist, create it containing just `{ "lsp": { … } }`.
- If an `lsp` object already exists, add or replace only its `claude-skills-lsp` entry and leave the other servers alone.
- If an existing entry points `path` at `server.js`, replace it with the form above. That is the old, broken setup.
- If `claude-skills-lsp.binary` already has the correct `path` and `arguments`, change nothing and say so. Re-running this skill after a `git pull` then only rebuilds.

Read the file back after the edit and check that the braces and commas are still balanced.

Project settings override global ones, so a stale project file silently undoes this step. If `${CLAUDE_PROJECT_DIR}/.zed/settings.json` exists and is not the file you just edited, read it. If its `claude-skills-lsp.binary.path` points at `server.js`, fix it to the form above too and tell the user you did. It is gitignored, so it won't show in `git status`.

## 4. Tell the user what's left

Two steps in Zed can't be automated from here. Tell the user:

1. **First time only:** command palette → **zed: install dev extension**, or **zed: extensions** (`cmd-shift-x`) → **Install Dev Extension**. In the folder picker, choose `<ABSOLUTE REPO PATH>/extension`, not the repo root. Zed compiles it itself, which takes about a minute. When it's done, **Claude Skills** appears in the Extensions list marked as a dev extension.
2. **Every time:** command palette → **editor: restart language server** with a `SKILL.md` open.

To check that it worked, open `fixtures/demo-skill/SKILL.md`. Four frontmatter lines should be underlined, and typing `effort: ` should offer five levels. If nothing happens, **dev: open language server logs** shows why. If the server never started, it won't appear there; check `~/Library/Logs/Zed/Zed.log` (macOS) or `~/.local/share/zed/logs/Zed.log` (Linux) for `claude-skills-lsp`.

End with one line naming the settings file you changed and the Node and server paths it now uses.
