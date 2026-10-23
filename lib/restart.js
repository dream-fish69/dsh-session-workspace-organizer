/**
 * Full-process restart support for the workspace organizer.
 *
 * Why this is not a plain "kill the Host":
 *
 * DSH Desktop spawns the Host as an owned child and treats *any* child exit as a
 * fatal failure. On a non-zero exit it calls `DesktopFatalRecovery.report()`,
 * which opens a NATIVE `dialog.showMessageBox()` ("startup failed" with exit /
 * restart / disable third-party plugins). A native OS dialog sits above the page
 * and cannot be covered or suppressed from the renderer, so a restart that only
 * ends the Host can never look calm.
 *
 * The Electron main process is the only owner of that dialog. So the restart
 * ends the main process FIRST: once it is gone, nothing can raise the dialog.
 * The Host then follows through its own clean path — the desktop host watches its
 * IPC channel and runs `shutdown.shutdown(0)` when the parent disappears — and
 * the detached helper replays the original application launch once the whole
 * tree is gone.
 *
 * The helper is written to disk rather than passed with `-e` so a failed restart
 * leaves a readable artifact and Windows quoting never enters the picture.
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat as fstat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

/** Loopback addresses that count as a direct local request. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Whether the request came directly from this machine, without a proxy hop.
 * @param request incoming HTTP request.
 * @returns true when the peer is loopback and no forwarding headers are present.
 */
export function isDirectLoopback (request) {
  const address = request.socket?.remoteAddress
  if (typeof address !== 'string' || !LOOPBACK.has(address)) return false
  const forwarded = request.headers['x-forwarded-for'] ?? request.headers['x-real-ip'] ?? request.headers.forwarded
  return forwarded === undefined
}

/**
 * Reject cross-site POSTs: a browser sends Origin, so it must match Host.
 * Requests without Origin (curl, same-origin navigations) are allowed.
 * @param request incoming HTTP request.
 * @returns true when the request is same-origin or carries no Origin.
 */
export function isSameOrigin (request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * The local listening port, falling back to the Host header.
 * @param request incoming HTTP request.
 * @returns port number or null.
 */
export function servingPort (request) {
  const local = request.socket?.localPort
  if (typeof local === 'number' && Number.isInteger(local) && local > 0 && local < 65536) return local
  const host = request.headers.host
  if (typeof host !== 'string') return null
  const match = /:(\d{1,5})$/u.exec(host)
  if (match === null) return null
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/**
 * Build a stable identifier for one Host boot, used by the client to notice that
 * the replacement actually came up.
 * @returns boot id.
 */
export function bootId () {
  return createHash('sha256')
    .update(`${String(process.pid)}|${String(process.uptime())}|${new Date().toISOString()}`)
    .digest('hex')
    .slice(0, 12)
}

/**
 * Process-wide restart state.
 *
 * A restart kills this process, so the page cannot learn the outcome from it.
 * The state therefore lives on `globalThis` and is re-published by the fresh
 * boot; the client also treats a changed boot id as success.
 * @returns shared restart state.
 */
export function restartState () {
  const key = Symbol.for('dsh.workspace-organizer.restart')
  if (globalThis[key] === undefined) {
    globalThis[key] = { revision: 0, pending: false, lastError: null }
  }
  return globalThis[key]
}

/**
 * Describe how this Host was launched, so the helper can replay it.
 *
 * Desktop: the Host is `<electron> --expose-internals <host entry> ...` running
 * with ELECTRON_RUN_AS_NODE=1, so the executable to restart is the Electron app
 * binary itself — not this Node-mode process.
 * CLI: `dsh web` runs the same entry under a normal Node binary.
 * @returns launch description for the application that owns this Host.
 */
export function appLaunch () {
  const execPath = process.execPath
  const electron = process.versions.electron !== undefined
  // The Desktop shell sets DSH_DESKTOP_NODE_EXECUTABLE for the Host and its
  // children; it names the Electron binary that owns the window.
  const shellBinary = process.env.DSH_DESKTOP_NODE_EXECUTABLE
  if (electron && typeof shellBinary === 'string' && shellBinary !== '') {
    return { file: shellBinary, args: [], cwd: dirname(shellBinary), desktop: true }
  }
  if (electron) {
    // Packaged Electron without the hint: relaunch the app binary bare.
    return { file: execPath, args: process.defaultApp === true ? [resolve(process.argv[1] ?? '')] : [], cwd: process.cwd(), desktop: true }
  }
  // CLI Host: replay the same interpreter and script.
  const argv1 = process.argv[1]
  if (typeof argv1 === 'string' && argv1 !== '') {
    return { file: execPath, args: [...process.execArgv, resolve(argv1), ...process.argv.slice(2)], cwd: process.cwd(), desktop: false }
  }
  return { file: execPath, args: process.argv.slice(2), cwd: process.cwd(), desktop: false }
}

/**
 * Whether an executable path names the DSH Desktop shell.
 *
 * The Electron main process runs the same binary this Host does (the Host is
 * that binary in Node mode), so a matching executable path is the strongest
 * evidence available without a process-query dependency.
 * @param path candidate executable path.
 * @returns true when it matches this process's own executable.
 */
function sameExecutable (path) {
  if (typeof path !== 'string' || path === '') return false
  const normalise = (value) => value.replaceAll('\\', '/').toLowerCase()
  return normalise(path) === normalise(process.execPath)
}

/**
 * Identify the Electron main process that owns this Host.
 *
 * Only a Host running under DSH Desktop has one, and ending the wrong process
 * would take out an unrelated terminal, so the candidate has to prove itself:
 *
 *  - this must be an Electron Host (a plain `dsh web` under Node has no shell);
 *  - the candidate is this process's parent — the shell spawns the Host and
 *    never re-parents it;
 *  - on Windows the parent's executable must be this same Electron binary.
 *
 * The environment variable is checked first because it is the cheapest exact
 * signal, but it is NOT required: packaged Desktop does not always export it,
 * which is why the executable comparison exists.
 * @returns parent process id, or undefined when this is not a Desktop Host.
 */
export function shellPid () {
  if (process.versions.electron === undefined) return undefined
  const parent = process.ppid
  if (typeof parent !== 'number' || !Number.isInteger(parent) || parent <= 1) return undefined
  const hint = process.env.DSH_DESKTOP_NODE_EXECUTABLE
  if (typeof hint === 'string' && hint !== '' && sameExecutable(hint)) return parent
  if (process.platform !== 'win32') return parent
  try {
    const query = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(parent)}").ExecutablePath`,
    ]
    const out = execFileSync('powershell', query, { encoding: 'utf8', timeout: 4000, windowsHide: true })
    return sameExecutable(out.trim()) ? parent : undefined
  } catch {
    // A failed query must never be read as "safe to kill".
    return undefined
  }
}

/**
 * Source of the detached helper.
 *
 * Order matters: end the Electron main process first, because it is the only
 * code that can raise the "startup failed" dialog. Killing it also drops the
 * Host's IPC channel, so the Host shuts itself down cleanly instead of being
 * signalled. Only when nothing from the old tree is left does the helper launch
 * the application again.
 * @param spec launch description from {@link appLaunch}.
 * @param shellPid Electron main process id, when known.
 * @param hostPid this Host process id.
 * @param port listening port, used as a second readiness signal.
 * @param logs stdout/stderr log paths.
 * @returns helper source.
 */
export function helperSource (spec, shellPid, hostPid, port, logs) {
  return `'use strict'
const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const file = ${JSON.stringify(spec.file)}
const args = ${JSON.stringify(spec.args)}
const cwd = ${JSON.stringify(spec.cwd)}
const desktop = ${JSON.stringify(spec.desktop)}
const shellPid = ${JSON.stringify(shellPid)}
const hostPid = ${JSON.stringify(hostPid)}
const port = ${JSON.stringify(port)}
const logOut = ${JSON.stringify(logs.out)}
const logErr = ${JSON.stringify(logs.err)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const note = (line) => { try { fs.appendFileSync(logErr, '[workspace-organizer] ' + line + '\\n') } catch {} }
process.on('uncaughtException', (e) => note('helper crashed: ' + (e && e.stack ? e.stack : e)))
process.on('unhandledRejection', (e) => note('helper rejection: ' + (e && e.stack ? e.stack : e)))
const alive = (pid) => {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' }
}
const waitGone = async (pid, limitMs) => {
  const until = Date.now() + limitMs
  while (Date.now() < until) {
    if (!alive(pid)) return true
    await sleep(120)
  }
  return !alive(pid)
}
const listening = () => new Promise((resolve) => {
  const probe = net.connect({ host: '127.0.0.1', port })
  const done = (v) => { probe.destroy(); resolve(v) }
  probe.on('connect', () => done(true))
  probe.on('error', () => done(false))
  setTimeout(() => done(false), 400)
})
const killTree = (pid) => new Promise((resolve) => {
  // /F /T: forced, whole tree. taskkill reports an already-gone process as an
  // error; that is success for this purpose.
  //
  // Deliberately WITHOUT /T. The helper is a descendant of the Host, which is a
  // child of this same shell, so a tree kill would terminate the helper in the
  // middle of its own restart — exactly the failure this guards against. Only
  // the shell process itself is ended; the Host then shuts itself down through
  // its IPC disconnect, which is the clean path.
  execFile('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true }, (error) => {
    if (error) note('taskkill ' + pid + ' -> ' + (error.message || String(error)))
    resolve()
  })
})
const main = async () => {
  note('helper up pid=' + process.pid + ' shell=' + shellPid + ' host=' + hostPid)
  await sleep(250)
  if (shellPid) {
    note('ending Electron main process ' + shellPid + ' first (it owns the fatal dialog)')
    await killTree(shellPid)
    await waitGone(shellPid, 10000)
    note('electron main gone: ' + !alive(shellPid))
  }
  if (hostPid && hostPid !== process.pid) {
    await waitGone(hostPid, 15000)
    note('host gone: ' + !alive(hostPid))
  }
  if (!desktop && port) {
    const until = Date.now() + 20000
    while (Date.now() < until && await listening()) await sleep(200)
  } else {
    await sleep(600)
  }
  const out = fs.openSync(logOut, 'a')
  const err = fs.openSync(logErr, 'a')
  note('launching ' + file + ' ' + JSON.stringify(args))
  // The helper itself runs with ELECTRON_RUN_AS_NODE=1 so that an Electron
  // binary can execute this script. That variable must NOT reach the relaunched
  // application: with it set, the shell would start in Node mode, open no
  // window, and exit immediately — which looks exactly like "closed but never
  // came back". Strip it, and drop the Host-only hints with it.
  const env = Object.assign({}, process.env)
  delete env.ELECTRON_RUN_AS_NODE
  delete env.DSH_DESKTOP_NODE_EXECUTABLE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  const child = spawn(file, args, {
    cwd,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: false,
    env,
  })
  child.on('error', (e) => note('spawn failed: ' + (e && e.message ? e.message : e)))
  child.unref()
  note('replacement launched pid=' + child.pid)
  // Verify the replacement actually stayed up. A shell that starts in the wrong
  // mode (or cannot acquire the single-instance lock) exits within a second,
  // and reporting success there is exactly what makes a restart look broken.
  await sleep(2500)
  if (child.pid !== undefined && alive(child.pid)) {
    note('restart complete; replacement is running')
  } else {
    note('replacement exited immediately; retrying once')
    const retry = spawn(file, args, {
      cwd,
      detached: true,
      stdio: ['ignore', out, err],
      windowsHide: false,
      env,
    })
    retry.on('error', (e) => note('retry spawn failed: ' + (e && e.message ? e.message : e)))
    retry.unref()
    await sleep(2500)
    note(retry.pid !== undefined && alive(retry.pid)
      ? 'restart complete after retry; replacement is running'
      : 'restart FAILED: replacement could not be started')
  }
}
main()
`
}

/**
 * Keep the restart log directory bounded.
 *
 * Every restart writes a fresh pair of logs and nothing ever removed them, so a
 * long-lived installation would accumulate files forever. Only the newest few
 * are kept: older ones describe restarts nobody is going to debug any more.
 * @param dir restart log directory.
 * @returns nothing; failures are ignored because logging must not block a restart.
 */
async function pruneRestartLogs (dir) {
  try {
    const names = (await readdir(dir)).filter((name) => /^restart-.*\.(?:out|err)\.log$/u.test(name))
    if (names.length <= 20) return
    const stat = async (name) => {
      try {
        return { name, at: (await fstat(join(dir, name))).mtimeMs }
      } catch {
        return { name, at: 0 }
      }
    }
    const entries = await Promise.all(names.map(stat))
    entries.sort((a, b) => b.at - a.at)
    await Promise.all(entries.slice(20).map((entry) => rm(join(dir, entry.name), { force: true })))
  } catch {}
}

/**
 * Write the helper and spawn it detached.
 * @param shellPid Electron main process id, when known.
 * @param port listening port.
 * @param home DSH home used for logs and the helper copy.
 * @returns helper pid and log paths.
 */
export async function scheduleRestart (shellPid, port, home) {
  const spec = appLaunch()
  const dir = join(home, 'workspace-organizer')
  await mkdir(dir, { recursive: true })
  await pruneRestartLogs(dir)
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  const logs = {
    out: join(dir, `restart-${stamp}.out.log`),
    err: join(dir, `restart-${stamp}.err.log`),
  }
  const script = join(dir, 'restart-helper.cjs')
  await writeFile(script, helperSource(spec, shellPid, process.pid, port, logs), 'utf8')
  // Detached spawn, deliberately NOT through `cmd /c start`.
  //
  // `start` looks tempting for leaving the parent tree, but it treats its first
  // quoted argument as a window title, so a path containing spaces silently
  // starts the wrong thing (or nothing) and the restart never happens. A
  // detached spawn is enough on Windows: the helper gets its own process group,
  // and the only thing that could still reach it was the tree kill, which this
  // helper no longer performs.
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    cwd: dir,
    windowsHide: true,
  })
  child.unref()
  return { helperPid: child.pid, script, logs, target: spec }
}

/**
 * Directory used for restart logs.
 * @param home DSH home.
 * @returns directory path.
 */
export function restartLogDir (home) {
  return join(home, 'workspace-organizer')
}
