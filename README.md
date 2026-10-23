# dsh-session-workspace-organizer

[![npm version](https://img.shields.io/npm/v/dsh-session-workspace-organizer.svg)](https://www.npmjs.com/package/dsh-session-workspace-organizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin: move a workspace folder to a new location, give every new session its own output folder, and restart the desktop app from the header.

English | [简体中文](README.zh.md)

DSH binds each session to a workspace directory, and every session of that workspace shares it — so scripts, logs, downloads and screenshots from unrelated conversations pile up in the same place. This plugin adds four things on top of that model, without patching DSH itself:

1. **Relocate a workspace** — move the folder to another path or disk and take its sessions with it. Every session log's header `cwd` is rewritten to the new path, so sessions keep working and stay listed under the new workspace.
2. **One output folder per session** — each new or resumed session gets `<workspace>/sessions/<YYYY-MM-DD>_<title>/`, the model is told (through a session-scoped system prompt) to write its artifacts there, and a `write` that would create a file at the workspace root asks for confirmation first.
3. **Session management** — move idle sessions to another workspace, or delete them (with a dry-run preview), optionally together with the files they created.
4. **Header restart** — a restart button that ends and relaunches the whole DSH process, with a confirmation dialog, a busy-work guard and a progress layer instead of a frozen page.

Tested with DSH Desktop `0.2.1-rc.2` on Windows. Host code uses Node built-ins only; the client is a hand-written CommonJS bundle, so there is no build step.

---

## Install

```sh
# from npm (prebuilt, no build approval needed)
dsh plugin --profile web add dsh-session-workspace-organizer

# from GitHub source
dsh plugin --profile web add github:dream-fish69/dsh-session-workspace-organizer

# local development checkout
dsh plugin --profile web add link:/absolute/path/to/the/checkout
```

On the **Desktop app**, use the Plugins page: remove the old entry, then install `dsh-session-workspace-organizer` or `github:dream-fish69/dsh-session-workspace-organizer` from the install field. Restart DSH after installing or upgrading — the Host half is only loaded at startup.

Uninstall:

```sh
dsh plugin --profile web remove dsh-session-workspace-organizer
```

Removing the plugin leaves the `sessions/` folders and their files alone.

## Where the UI lives

**Settings → Workspaces** (the section title follows the DSH language: `工作区` in Chinese). Three things live there:

### Move workspace

Pick a registered workspace, choose a target parent folder and type the new folder name.

The plugin then performs a **strict relocation**:

- the whole directory — `sessions/` included — is moved to the new path, and the **old path is deleted**; no junction or symlink is left behind;
- each session log whose header `cwd` equals the old path is rewritten: the first zstd frame carries the header, only its `cwd` is replaced, and every later frame is kept byte-identical; the log directory is then moved from `--<old cwd>--` to `--<new cwd>--`;
- the workspace is re-registered from the new path and sessions are attached to it; sessions this running process cannot attach yet are recorded in `pending-attach.json` and attached automatically after a DSH restart;
- a cross-disk move copies first and verifies file by file, keeps the source until the copy is verified, and rolls back on failure;
- if the old directory is locked (Windows `EBUSY`/`EPERM`/`EACCES` — e.g. DSH still holds a handle), the plugin falls back to a copy migration: copy and verify, rewrite the copied logs, switch the registry, then delete the old directory if it can and report the exact reason when it cannot.

**Hard requirement:** the workspace being moved must have no running session, because session logs are append-only and a live write handle cannot be rewritten safely. Open a conversation in **another** workspace and trigger the move from there. If sessions are still running, a dialog lists them (title + id) and offers to cancel their turns, wait for them to settle, and continue with the copy path — unless the session you are typing in is itself in the target workspace, which always has to be moved from elsewhere.

If the old path was DSH's launch directory, the plugin also switches the process working directory and the sandbox fallback root, but desktop shortcuts or launcher configuration still have to be updated by hand.

### Organize structure

Creates `sessions/` and `sessions/README.md` when missing. With **move loose files** ticked, ordinary files sitting at the workspace root are moved into `sessions/<date>_整理/`; dotfiles, `README.md`, `AGENTS.md` and common project manifests are left where they are.

### Sessions

- **Move to workspace…** — moves idle sessions (single or batch) into another workspace: their logs, their `sessions/` folder with everything inside it, and files the session wrote through `write`/`edit` elsewhere inside the source workspace.
- **Unresolved files (single move)** — click **Preview unresolved files** before moving. The plan lists unmarked legacy session folders, relative write paths (write-time cwd unknown), files outside the source workspace, target conflicts, and an optional project folder. For each row choose **Target session folder**, **Target workspace root**, **Custom directory…**, or **Cancel this item** (default). Known files move automatically; canceled items stay where they are.
- **Legacy folders/projects** — the optional **Legacy session folder** and **Project folder** fields merge/move those explicitly. Conflicting files keep the target file and get a source-tagged copy such as `verify.COT中文翻译插件.md`; nothing is overwritten.
- **Delete** — permanent deletion of idle sessions, with a **preview** first that lists the log, the session folder and any external files that would go away. Files written by that session outside `sessions/` are only removed when you tick that option, and only inside the session's source workspace.
- Batch moves still use the known destinations; unresolved items are reported and left in place. Use a single move when you need to choose a destination per item.

## Per-session output folders

For every new or resumed session whose `cwd` is inside a registered workspace:

- `<workspace>/sessions/<YYYY-MM-DD>_<title>/` is created, and renamed when the session title changes (the date prefix stays; duplicates get `-2`);
- a `.dsh-session` marker inside the folder records `sessionId`, `workspacePath` and `createdAt`, so a resumed session finds its folder again — do not delete it;
- the model receives a session-scoped system prompt saying that new scripts, logs, downloads, screenshots, temporary data and one-off artifacts belong in that folder, while existing project code stays where it is;
- creating a file at the **workspace root** with `write` triggers a confirmation dialog; existing files and common manifests (`README.md`, `AGENTS.md`, `package.json`, lockfiles, `Makefile`, `Dockerfile`, …) pass through untouched.

## Restart from the header

The restart button in the conversation header ends and relaunches the **whole application**, so every cached service, plugin and module is rebuilt from disk — unlike a page refresh.

- **It asks first.** Clicking opens a confirmation dialog that says the app will close and start again and that running work is interrupted. Escape, the backdrop and Cancel all dismiss it.
- **Live work is protected.** While a session is generating, a turn is queued or a background job is running, the confirm button becomes a red *Restart anyway* that is no longer the default; the safe choice stays the easy one. `{"force": true}` overrides the gate server-side, and nothing malformed ever counts as force.
- **Progress instead of a frozen page.** A full-screen layer with a two-ring spinner, an indeterminate bar and a status line is drawn directly on `document.body`, so it survives the React tree being torn down. A failed restart flips it to a red state that names the error instead of spinning forever.
- **No native error dialog.** DSH Desktop treats any Host child exit as fatal and raises an OS message box that cannot be covered from the renderer. The helper therefore ends the Electron main process first, lets the Host follow through its own IPC disconnect, then relaunches the app once the tree is gone — and it verifies the replacement stayed alive.
- Restart logs are pruned to the newest 20 pairs. An interrupted JSONL write is repaired on the next open, so a forced exit cannot corrupt a session log.

`GET /workspace-organizer/restart` reports whether a restart is possible (`mode`, `revision`, `lastError`), and answers `409` with `busy: true` while work is live.

## Configuration

Override the plugin row in the profile's `cordis.patch.yml`:

```yaml
- id: workspace-organizer
  config:
    sessionFolders: true      # create the per-session output folder
    guardRootWrites: true     # confirm before creating files at the workspace root
    sessionsDirName: sessions # parent folder name for session folders
    maxTitleChars: 40         # max title characters in the folder name (8-80)
    # sessionsRoot: /path/to/dsh/home/sessions   # only if DSH stores logs elsewhere
```

## Safety notes

- Strict relocation **deletes the old directory**. It only runs after the blocker precheck, it writes the new location and the rewrites before deleting anything, and it rolls back when a step fails — but there is no "keep both folders" mode by design. Use a copy migration (the automatic fallback) if you want the old directory kept.
- Rewriting session logs is an **offline** operation. Restart DSH after moving, so the session list, search index and persistence caches re-read the new path.
- A workspace containing symlinks or junctions is refused for the copy fallback (to avoid duplicating cycles or losing links); same-disk rename is unaffected.
- Sessions that were already open before the plugin was installed get their folder on the next resume, not retroactively.
- All destructive commands require a confirmation token minted by the check/preview step; the client never sends a bare "delete".

## Compatibility and limitations

- DSH `0.2.x` (Web and Desktop profiles that include `dsh-base` + `dsh-web-app`).
- Busy-handle handling keys off Windows error codes; on other platforms the copy fallback is simply the normal path.
- Movement and deletion run as commands recorded in an open conversation, so a session must be open; that session must not belong to the workspace being moved.
- The sidebar's workspace "…" menu has no extension slot in DSH, which is why the entry point lives in Settings.

## How it works

| Layer | File | Responsibility |
| --- | --- | --- |
| Host | `index.js` | Registers the `workspace-relocate-check` / `workspace-relocate-strict` / `workspace-organize` / `session-relocate-plan` / `session-relocate` / `session-relocate-batch` / `session-delete-preview` / `session-delete` / `session-delete-batch` commands; `agent/created` builds the session folder and the scoped prompt; `session/event` renames it on title change; `tools/pre-execute` guards root writes; serves the restart route |
| Host | `lib/fs-ops.js` | Directory move (same-disk rename, cross-disk copy + verify + rollback), name sanitizing, loose-file scan |
| Host | `lib/session-logs.js` | zstd first-frame header parsing, `cwd`-only rewrite, later frames untouched, log-directory re-homing |
| Host | `lib/restart.js` | Full-process restart: shell-first shutdown (so no native error dialog), detached relaunch helper, liveness check, bounded restart logs |
| Client | `client.js` | `settings.section` page with the move / organize / sessions dialogs, the header restart button and its confirmation/progress layers, bilingual copy from `locale/*.json` |

## Development

```sh
npm run check   # node --check on index.js, client.js and the three lib modules
npm test        # node --test tests/ (path safety, copy/merge, header rewrite, restart routes)
```


No bundler: `lib/` is the committed source, `client.js` is the bundle DSH loads through `window.__ModuleLoader__`. Host changes need a DSH restart; client changes need a page refresh.

## License

MIT
