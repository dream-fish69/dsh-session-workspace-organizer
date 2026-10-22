# Changelog

## 1.0.0 — 2026-10-23

First public release.

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
- Delete idle sessions with a dry-run preview; optional removal of the files the session wrote.
- Destructive commands require a one-time confirmation token minted by the check/preview step.

**Structure**
- `sessions/` bootstrap with `sessions/README.md`.
- Optional move of loose workspace-root files into `sessions/<date>_整理/`.
- Bilingual UI (English / 简体中文) following the DSH language setting.
