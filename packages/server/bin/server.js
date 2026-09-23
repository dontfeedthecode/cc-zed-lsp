#!/usr/bin/env node
// Thin launcher so `npm bin` and Zed's `worktree.which()` both resolve to a
// stable path regardless of how the TypeScript build is laid out.
import('../dist/server.js');
