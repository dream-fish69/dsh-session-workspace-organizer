# Changelog

## 1.18.0 — 2026-10-24

First release since 1.0.0. Everything below is new compared with the published 1.0.0.

**Restart from the header**
- New restart button in the conversation header. It ends and relaunches the whole DSH process, so every cached service, plugin and module is rebuilt from disk — a page refresh is not the same thing.
- Clicking it opens a confirmation dialog instead of restarting immediately: it states that the whole application will close and start again and that running work is interrupted. Escape, the backdrop and Cancel all dismiss it, so a stray click cannot end the session.
- When a session is still generating, the dialog says so and turns the confirm button into a red "Restart anyway" that is no longer the default action — the safe choice stays the easy one.
- A full-screen progress layer replaces the frozen page during the restart: a two-ring spinner, an indeterminate bar and a short status line, drawn with plain DOM on `document.body` so it survives the React tree being torn down. If the restart fails it flips to a red state that names the error and says how to recover, instead of spinning forever.
- A restart is refused while work is live (an agent generating, a queued inbox turn or step, or a running background job). The reply is `409` with `busy: true`; `{"force": true}` overrides the gate after the UI asks once, and a malformed, empty or oversized body never counts as force.
- No native error dialog: DSH Desktop treats any Host child exit as fatal and raises an OS message box the renderer cannot cover, so the helper ends the Electron main process first, lets the Host follow through its own IPC disconnect, then relaunches the app once the tree is gone — and verifies the replacement stayed alive, retrying once if it exited immediately.
- The relaunched application no longer inherits `ELECTRON_RUN_AS_NODE` (which started it in Node mode and made it exit at once), and the helper no longer kills itself with a `/T` tree-wide `taskkill`.
- Restart logs are pruned to the newest 20 pairs, so a long-lived installation cannot accumulate them. An interrupted JSONL write is repaired on the next open, so a forced exit cannot corrupt a session log.
- The button always re-enables after a failure; `GET /workspace-organizer/restart` reports `mode`, `revision` and `lastError`.

**Workspace relocation**
- Strict relocation: move the whole workspace folder, rewrite every session log's header `cwd` (zstd first frame only, later frames byte-identical), re-home the log directories from `--old-cwd--` to `--new-cwd--`, re-register the workspace, delete the old path.
- Blocker precheck with an optional force-stop of sessions still running in the target workspace.
- Cross-disk moves copy, verify file by file, and roll back on failure.
- Automatic copy fallback when the old directory is locked by a running process.
- Sessions that cannot be attached immediately are recorded and attached after the next DSH restart.

**Per-session output folders**
- `<workspace>/sessions/<YYYY-MM-DD>_<title>/` created for new and resumed sessions, renamed when the title changes.
- `.dsh-session` marker for resume lookup.
- Session-scoped system prompt that directs new artifacts into the folder.
- Root-write guard: `write` creating a file at the workspace root asks for confirmation, with an allowlist for common project manifests.

**Session management**
- Move idle sessions (single or batch) to another workspace, including their logs, their session folder and files they wrote inside the source workspace.
- Single-session moves can preview unresolved files/folders: unmarked legacy session folders, relative write paths, files outside the source workspace, target conflicts, and an optional project folder. Each item can be sent to the target session folder, the target workspace root, a custom directory, or canceled (default). Known files move automatically; canceled items stay in place.
- Optional legacy session folder and project folder fields merge/move those explicitly. Existing target files are never overwritten: conflicts keep the target and get a source-tagged copy (for example `verify.COT中文翻译插件.md`).
- If the target already has the session folder (for example a marker-only folder), the source folder is merged into it instead of creating a duplicate.
- Delete idle sessions with a dry-run preview; optional removal of the files the session wrote.
- Destructive commands require a one-time confirmation token minted by the check/preview step; the interactive relocation plan uses a 5-minute `session-relocate-plan` token.

**Structure**
- `sessions/` bootstrap with `sessions/README.md`.
- Optional move of loose workspace-root files into `sessions/<date>_整理/`.
- Bilingual UI (English / 简体中文) following the DSH language setting.

**Tests**
- `tests/fs-ops.test.mjs`, `tests/session-logs.test.mjs` and `tests/restart.test.mjs` cover path safety, marker folders, verified copy/merge with hashes, same-volume relocation, header rewriting, written-path parsing and the restart route contract.

## 1.0.0 — 2026-10-23

First public release: workspace relocation, per-session output folders and session management. See 1.18.0 for the full feature list.

