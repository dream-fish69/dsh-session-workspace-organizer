import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { cp, mkdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, parse, relative, resolve } from 'node:path'
import os from 'node:os'
import {
  copyDirectoryKeepingSource,
  createUniqueDirectory,
  ensureFile,
  findSessionFolder,
  formatDatePrefix,
  isAbsolutePath,
  isBusyError,
  isDirectory,
  isInside,
  isSameOrInside,
  listLooseRootFiles,
  pathExists,
  readSessionMarker,
  relocateDirectory,
  resolvePath,
  rollbackRelocate,
  samePath,
  sameRoot,
  sanitizeFolderName,
  uniqueChildName,
  validateLeafName,
  writeSessionMarker,
} from './lib/fs-ops.js'
import {
  collectSessionWrittenPaths,
  copySessionDir,
  findCurrentLogFile,
  moveSessionDir,
  restoreLogHeader,
  rewriteLogCwd,
  scanProjectSessions,
  sessionProjectKey,
} from './lib/session-logs.js'

const SECTION_NAME = 'workspace-organizer:session-folder'
const SECTION_ORDER = 950
const DEFAULT_SESSIONS_DIR = 'sessions'
const DEFAULT_MAX_TITLE_CHARS = 40

const ROOT_FILE_ALLOWLIST = new Set([
  'readme.md', 'agents.md', 'claude.md', 'license', 'license.md', 'notice',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'yarn.lock', 'bun.lockb', 'tsconfig.json', 'jsconfig.json',
  'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'pipfile',
  'pipfile.lock', 'poetry.lock', 'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum',
  'makefile', 'cmakelists.txt', 'dockerfile', 'docker-compose.yml',
  '.gitignore', '.gitattributes', '.editorconfig', '.env.example',
])

const SESSIONS_README = `# sessions

本目录由 DSH 插件 dsh-session-workspace-organizer 维护。

- 每个会话创建时会得到 \`YYYY-MM-DD_<会话标题>/\` 子目录。
- 本会话产生的脚本、日志、下载、截图、临时数据和一次性产物，应保存在该会话目录中。
- 工作区根目录只保留项目目录、\`sessions/\`、\`README.md\`、\`AGENTS.md\` 等长期文件。
- 已有项目代码和资源在原位置修改，不要为了整理而搬动。
- 每个会话目录里的 \`.dsh-session\` 是身份标记，请勿删除。

插件只在文件缺失时创建本说明；可以自由修改。
`

export const inject = [
  'commands',
  'sessions',
  'agents',
  'workingDirectory',
  'workspaceRegistry',
  'systemPrompt',
  'sandboxPolicy',
  'sessionPersistence',
]

/**
 * Read the row config with safe fallbacks.
 * @param raw row config from the Loader.
 * @returns normalized settings.
 */
function readConfig (raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  let sessionsDirName = typeof source.sessionsDirName === 'string'
    ? source.sessionsDirName.trim()
    : DEFAULT_SESSIONS_DIR
  if (
    sessionsDirName === '' || sessionsDirName === '.' || sessionsDirName === '..' ||
    /[\\/<>:"|?*\u0000-\u001f]/.test(sessionsDirName)
  ) {
    sessionsDirName = DEFAULT_SESSIONS_DIR
  }
  const maxTitleChars = Number.isInteger(source.maxTitleChars) &&
    source.maxTitleChars >= 8 && source.maxTitleChars <= 80
    ? source.maxTitleChars
    : DEFAULT_MAX_TITLE_CHARS
  const home = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME : ''
  const sessionsRoot = typeof source.sessionsRoot === 'string' && source.sessionsRoot.trim() !== ''
    ? resolve(source.sessionsRoot.trim())
    : (home === '' ? '' : join(home, 'sessions'))
  return {
    sessionsDirName,
    maxTitleChars,
    sessionsRoot,
    sessionFolders: source.sessionFolders !== false,
    guardRootWrites: source.guardRootWrites !== false,
  }
}

/**
 * Normalize a command's free-form JSON input.
 * @param rawInput text after the command name.
 * @returns the parsed object.
 */
function parseJsonInput (rawInput) {
  const text = String(rawInput ?? '').trim()
  if (text === '') throw new Error('缺少参数；示例：{"workspaceId":"…","targetParent":"…","name":"…"}')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('参数必须是合法的 JSON 对象')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('参数必须是 JSON 对象')
  }
  return value
}

/**
 * Map a directory that lived under the old root onto the new root.
 * @param path original directory.
 * @param oldRoot old workspace root.
 * @param newRoot new workspace root.
 * @returns the corresponding directory under the new root.
 */
function remapPath (path, oldRoot, newRoot) {
  if (samePath(path, oldRoot)) return newRoot
  if (isInside(oldRoot, path)) return join(newRoot, relative(oldRoot, path))
  return newRoot
}

/**
 * Render the per-agent system-prompt section for one session folder.
 * @param info live session folder state.
 * @returns prompt text.
 */
function sessionFolderText (info) {
  return [
    '## 会话输出目录',
    '',
    `本会话的专属输出目录（已创建）：\`${info.folderPath}\``,
    '',
    '规则：',
    `- 本会话新建的脚本、日志、下载、截图、临时数据和一次性产物，一律保存在这个目录里；不要放在工作区根目录（\`${info.workspacePath}\`）。`,
    '- 已有项目的代码和资源在原位置修改，不要为了“整理”搬动已有文件。',
    '- 工作区根目录只应保留项目目录、`sessions/`、`README.md`、`AGENTS.md` 等长期文件。',
  ].join('\n')
}

/**
 * Move one file, falling back to copy when the source is locked or on another
 * volume. A locked source is left in place and reported as `copy-keep`.
 * @param sourceFile existing file.
 * @param targetFile absent destination.
 * @returns how the move was performed.
 */
async function moveWrittenFile (sourceFile, targetFile) {
  try {
    await rename(sourceFile, targetFile)
    return 'rename'
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EBUSY' && error.code !== 'EPERM') throw error
  }
  await cp(sourceFile, targetFile, { force: false, errorOnExist: true, preserveTimestamps: true })
  try {
    await rm(sourceFile, { force: true })
    return 'copy'
  } catch {
    return 'copy-keep'
  }
}

export function apply (ctx, rawConfig = {}) {
  const config = readConfig(rawConfig)

  /**
   * Resolve the active profile directory without relying on a shell-only env.
   * @returns the absolute profile directory, or an empty string.
   */
  function profileDirOf () {
    if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
      return process.env.DSH_PROFILE_DIR
    }
    const env = ctx.get('profileContext')?.packageManager?.env
    if (env !== null && typeof env === 'object' && typeof env.DSH_PROFILE_DIR === 'string') {
      return env.DSH_PROFILE_DIR
    }
    const home = (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '')
      ? process.env.DSH_HOME
      : (env !== null && typeof env === 'object' && typeof env.DSH_HOME === 'string' && env.DSH_HOME !== ''
          ? env.DSH_HOME
          : (config.sessionsRoot !== '' ? dirname(config.sessionsRoot) : ''))
    if (home !== '') {
      try {
        for (const name of readdirSync(join(home, 'profiles'))) {
          const candidate = join(home, 'profiles', name)
          if (existsSync(join(candidate, 'node_modules', 'dsh-session-workspace-organizer', 'package.json'))) {
            return candidate
          }
        }
      } catch {}
    }
    return ''
  }

  if (config.sessionsRoot === '') {
    const backend = ctx.get('sessionPersistence')
    const backendRoot = backend !== null && typeof backend === 'object' ? backend.root : undefined
    if (typeof backendRoot === 'string' && backendRoot !== '') {
      config.sessionsRoot = resolve(backendRoot)
    } else {
      const env = ctx.get('profileContext')?.packageManager?.env
      const home = (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '')
        ? process.env.DSH_HOME
        : (env !== null && typeof env === 'object' && typeof env.DSH_HOME === 'string' && env.DSH_HOME !== ''
            ? env.DSH_HOME
            : (profileDirOf() !== '' ? dirname(dirname(profileDirOf())) : ''))
      if (home !== '') config.sessionsRoot = join(home, 'sessions')
    }
  }

  const infos = new Map()
  const sectionDisposers = new Map()
  const renameChains = new Map()
  const confirmations = new Map()
  let operationTail = Promise.resolve()

  /**
   * Serialize destructive operations so pending/registry/log changes cannot
   * interleave across two commands.
   * @param operation async operation.
   * @returns the operation result.
   */
  function withOperationLock (operation) {
    const run = operationTail.then(operation, operation)
    operationTail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Canonical JSON used to bind a one-time confirmation to its exact payload.
   * @param value payload.
   * @returns stable string.
   */
  function stableFingerprint (value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableFingerprint).join(',')}]`
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableFingerprint(value[key])}`).join(',')}}`
  }

  /**
   * Issue a short-lived, one-time confirmation token for a destructive action.
   * Tokens are deliberately not a security boundary; they force the settings
   * page preview/check step before a command can delete or move data.
   * @param kind operation kind.
   * @param payload exact operation payload.
   * @returns token.
   */
  function issueConfirmation (kind, payload) {
    if (confirmations.size >= 200) throw new Error('待确认操作过多，请稍后重试。')
    const token = randomUUID()
    confirmations.set(token, {
      kind,
      fingerprint: stableFingerprint(payload),
      expiresAt: Date.now() + 5 * 60 * 1000,
    })
    const timer = setTimeout(() => confirmations.delete(token), 5 * 60 * 1000)
    timer.unref?.()
    return token
  }

  /**
   * Consume a confirmation token if it matches the exact operation.
   * @param kind operation kind.
   * @param token client-supplied token.
   * @param payload exact operation payload.
   */
  function requireConfirmation (kind, token, payload) {
    const entry = typeof token === 'string' ? confirmations.get(token) : undefined
    if (
      entry === undefined ||
      entry.expiresAt < Date.now() ||
      entry.kind !== kind ||
      entry.fingerprint !== stableFingerprint(payload)
    ) {
      throw new Error('操作确认已失效或与当前操作不匹配；请在设置页重新预览并确认。')
    }
    confirmations.delete(token)
  }

  /**
   * Paths that must never be moved or deleted as a workspace.
   * @returns canonical protected paths.
   */
  async function protectedPaths () {
    const raw = new Set()
    const add = (value) => {
      if (typeof value !== 'string' || value === '') return
      try { raw.add(resolve(value)) } catch {}
    }
    const profile = profileDirOf()
    add(profile)
    if (profile !== '') add(dirname(dirname(profile)))
    const env = ctx.get('profileContext')?.packageManager?.env
    add(process.env.DSH_HOME)
    if (env !== null && typeof env === 'object') add(env.DSH_HOME)
    const home = (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '')
      ? process.env.DSH_HOME
      : (env !== null && typeof env === 'object' && typeof env.DSH_HOME === 'string' ? env.DSH_HOME : '')
    if (home !== '') add(join(home, 'profiles'))
    add(config.sessionsRoot)
    add(process.resourcesPath)
    if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
      add(dirname(process.resourcesPath))
    }
    add(process.execPath)
    if (typeof process.execPath === 'string' && process.execPath !== '') {
      add(dirname(process.execPath))
    }
    const resolved = []
    for (const path of raw) {
      try {
        resolved.push(await realpath(path))
      } catch {
        resolved.push(path)
      }
    }
    return [...new Set(resolved)]
  }

  /**
   * Refuse a workspace/session path that is, contains, or lives inside a
   * protected DSH/profile/session path.
   * @param path candidate path.
   * @param label user-facing label.
   * @param options.mustExist require realpath to resolve.
   * @returns canonical path.
   */
  async function assertSafePath (path, label, options = {}) {
    if (typeof path !== 'string' || path === '') throw new Error(`${label}路径为空`)
    let canonical
    try {
      canonical = await realpath(path)
    } catch {
      if (options.mustExist !== false) throw new Error(`${label}不存在：${path}`)
      canonical = resolve(path)
    }
    if (samePath(parse(canonical).root, canonical)) {
      throw new Error(`${label}不能是磁盘根目录：${canonical}`)
    }
    for (const protectedPath of await protectedPaths()) {
      if (isSameOrInside(canonical, protectedPath) || isSameOrInside(protectedPath, canonical)) {
        throw new Error(`${label}与受保护路径重叠，拒绝操作：${protectedPath}`)
      }
    }
    return canonical
  }
  // Boot can run before the workspace registry and session store are ready, so
  // the pending-attach journal is retried a bounded number of times.
  const PENDING_RETRY_DELAYS = [500, 1500, 3000, 6000, 12000, 30000]
  let pendingTimer
  const pendingPath = config.sessionsRoot === ''
    ? ''
    : join(dirname(config.sessionsRoot), 'workspace-organizer', 'pending-attach.json')
  let alive = true

  if (pendingPath !== '') {
    void mkdir(dirname(pendingPath), { recursive: true })
      .then(() => writeFile(join(dirname(pendingPath), 'version.json'), JSON.stringify({ version: '2-strict-retry', loadedAt: new Date().toISOString() }), 'utf8'))
      .catch(() => {})
  }

  ctx.effect(() => () => {
    alive = false
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer)
      pendingTimer = undefined
    }
    for (const disposer of sectionDisposers.values()) {
      try { disposer() } catch (error) { ctx.logger.warn('workspace-organizer: section dispose failed', error) }
    }
    sectionDisposers.clear()
    infos.clear()
    renameChains.clear()
  })

  /**
   * Read the durable pending-attach journal.
   * @returns pending workspace/session mappings.
   */
  async function readPendingAttach () {
    if (pendingPath === '') return []
    try {
      const parsed = JSON.parse(await readFile(pendingPath, 'utf8'))
      return Array.isArray(parsed) ? parsed.filter((entry) => entry !== null && typeof entry === 'object') : []
    } catch {
      return []
    }
  }

  /**
   * Replace the durable pending-attach journal.
   * @param entries entries to persist.
   */
  async function writePendingAttach (entries) {
    if (pendingPath === '') return
    await mkdir(dirname(pendingPath), { recursive: true })
    const temp = `${pendingPath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temp, JSON.stringify(entries, null, 2), 'utf8')
    await rename(temp, pendingPath)
  }

  /**
   * Merge one workspace/session group into the pending-attach journal.
   * @param workspaceId target workspace.
   * @param workspacePath target workspace directory.
   * @param sessionIds sessions to attach after restart.
   */
  async function mergePendingAttach (workspaceId, workspacePath, sessionIds) {
    const entries = await readPendingAttach()
    const index = entries.findIndex((entry) => entry.workspaceId === workspaceId)
    if (index >= 0) {
      const merged = [...new Set([...(Array.isArray(entries[index].sessionIds) ? entries[index].sessionIds : []), ...sessionIds])]
      entries[index] = { ...entries[index], workspacePath, sessionIds: merged, updatedAt: new Date().toISOString() }
    } else {
      entries.push({
        workspaceId,
        workspacePath,
        sessionIds: [...new Set(sessionIds)],
        createdAt: new Date().toISOString(),
      })
    }
    await writePendingAttach(entries)
  }

  /**
   * Remove one session from the pending-attach journal.
   * @param workspaceId target workspace.
   * @param sessionId session that attached successfully.
   */
  async function removePendingSession (workspaceId, sessionId) {
    const entries = await readPendingAttach()
    const next = []
    for (const entry of entries) {
      if (entry.workspaceId !== workspaceId) {
        next.push(entry)
        continue
      }
      const ids = (Array.isArray(entry.sessionIds) ? entry.sessionIds : []).filter((id) => id !== sessionId)
      if (ids.length > 0) next.push({ ...entry, sessionIds: ids })
    }
    await writePendingAttach(next)
  }

  /**
   * Remove one session from every pending-attach entry.
   * @param sessionId session that is being deleted.
   */
  async function removePendingSessionEverywhere (sessionId) {
    const entries = await readPendingAttach()
    const next = []
    for (const entry of entries) {
      const ids = (Array.isArray(entry.sessionIds) ? entry.sessionIds : []).filter((id) => id !== sessionId)
      if (ids.length > 0) next.push({ ...entry, sessionIds: ids })
    }
    await writePendingAttach(next)
  }

  /**
   * After a restart the workspace registry has fresh headers; attach sessions a
   * strict migration could not attach in the previous process.
   * @returns how many journal entries still need a retry.
   */
  async function processPendingAttach () {
    return withOperationLock(processPendingAttachUnlocked)
  }

  async function processPendingAttachUnlocked () {
    const entries = await readPendingAttach()
    if (entries.length === 0) return 0
    const remaining = []
    for (const entry of entries) {
      if (typeof entry.workspaceId !== 'string' || !Array.isArray(entry.sessionIds)) continue
      const workspace = ctx.workspaceRegistry.get(entry.workspaceId)
      if (workspace === undefined) {
        // Boot can run before the registry finishes loading. Dropping the entry
        // here would strand its sessions forever, so keep it for the retry pass.
        remaining.push(entry)
        continue
      }
      const attached = new Set(Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [])
      let failures = 0
      for (const sessionId of entry.sessionIds) {
        if (typeof sessionId !== 'string') continue
        if (attached.has(sessionId)) continue
        try {
          await workspace.attachSession(sessionId)
          attached.add(sessionId)
        } catch (error) {
          failures += 1
          ctx.logger.warn(`workspace-organizer: 待归属会话 ${sessionId} 仍未挂上`, error)
        }
      }
      if (failures === 0) {
        ctx.logger.info(`workspace-organizer: 已重新归属 ${entry.sessionIds.length} 个会话`)
      } else {
        remaining.push({ ...entry, lastFailures: failures })
      }
    }
    await writePendingAttach(remaining)
    return remaining.length
  }

  /**
   * Retry the pending-attach journal with bounded backoff. A boot-time pass can
   * legitimately see no workspace yet, and a relocate can race the registry, so
   * one attempt is not enough evidence to discard the journal.
   * @param attempt zero-based retry index.
   */
  function schedulePendingAttach (attempt = 0) {
    if (!alive || pendingTimer !== undefined) return
    const delay = PENDING_RETRY_DELAYS[Math.min(attempt, PENDING_RETRY_DELAYS.length - 1)]
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined
      void processPendingAttach().then((unresolved) => {
        if (!alive || unresolved === 0) return
        if (attempt + 1 < PENDING_RETRY_DELAYS.length) schedulePendingAttach(attempt + 1)
      }).catch((error) => {
        ctx.logger.warn('workspace-organizer: 处理待归属会话失败', error)
        if (alive && attempt + 1 < PENDING_RETRY_DELAYS.length) schedulePendingAttach(attempt + 1)
      })
    }, delay)
    pendingTimer.unref?.()
  }

  /**
   * Read the latest accepted session title from the durable log.
   * @param session live session.
   * @returns the newest title text, or undefined.
   */
  function latestTitle (session) {
    const events = session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].type === 'session/title') return events[index].data.title
    }
    return undefined
  }

  /**
   * Rename one session folder to match its current title.
   * @param info live session folder state.
   */
  async function renameSessionFolder (info) {
    if (!alive || !config.sessionFolders) return
    if (!(await pathExists(info.folderPath))) return
    const sessionsDir = join(info.workspacePath, config.sessionsDirName)
    const base = `${info.datePrefix}_${sanitizeFolderName(info.title || '会话', config.maxTitleChars)}`
    if (samePath(join(sessionsDir, base), info.folderPath)) return
    let target = join(sessionsDir, base)
    if (await pathExists(target) && !samePath(target, info.folderPath)) {
      target = join(sessionsDir, await uniqueChildName(sessionsDir, base))
    }
    try {
      await rename(info.folderPath, target)
      info.folderPath = target
    } catch (error) {
      ctx.logger.warn(`workspace-organizer: 无法重命名会话目录 ${info.folderPath} -> ${target}`, error)
    }
  }

  /**
   * Serialize folder renames for one session so title bursts cannot race.
   * @param info live session folder state.
   */
  function scheduleRename (info) {
    const previous = renameChains.get(info.sessionId) ?? Promise.resolve()
    const next = previous
      .then(() => renameSessionFolder(info))
      .catch((error) => { ctx.logger.warn('workspace-organizer: session folder rename failed', error) })
    renameChains.set(info.sessionId, next)
    void next.finally(() => {
      if (renameChains.get(info.sessionId) === next) renameChains.delete(info.sessionId)
    })
  }

  /**
   * Create or adopt the session folder for one new or resumed agent.
   * @param agent live agent.
   */
  async function ensureSessionFolder (agent) {
    if (!config.sessionFolders) return
    const session = agent.session
    if (session.header.origin === 'subagent') return
    if ((session.header.delegationDepth ?? 0) > 0) return
    const cwd = session.header.cwd
    if (typeof cwd !== 'string' || cwd === '') return
    let workspace
    try {
      workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
    } catch {
      return
    }
    if (workspace === undefined) return
    const sessionsDir = join(workspace.path, config.sessionsDirName)
    try {
      await mkdir(sessionsDir, { recursive: true })
    } catch (error) {
      ctx.logger.warn(`workspace-organizer: 无法创建 sessions 目录 ${sessionsDir}`, error)
      return
    }
    const title = latestTitle(session)
    const datePrefix = formatDatePrefix(session.header.createdAt)
    let folder = await findSessionFolder(sessionsDir, session.id)
    if (folder === undefined) {
      const base = `${datePrefix}_${sanitizeFolderName(title ?? '会话', config.maxTitleChars)}`
      folder = await createUniqueDirectory(sessionsDir, base)
      await writeSessionMarker(folder, {
        sessionId: session.id,
        workspacePath: workspace.path,
        createdAt: new Date().toISOString(),
      })
    }
    const info = {
      sessionId: session.id,
      workspacePath: workspace.path,
      folderPath: folder,
      datePrefix,
      title: title ?? '',
    }
    infos.set(session.id, info)
    const previous = sectionDisposers.get(session.id)
    if (previous !== undefined) {
      try { previous() } catch {}
      sectionDisposers.delete(session.id)
    }
    try {
      const disposer = agent.ctx.effect(() => agent.ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: () => sessionFolderText(info),
      }))
      sectionDisposers.set(session.id, disposer)
    } catch (error) {
      ctx.logger.warn('workspace-organizer: 无法注册会话目录提示', error)
    }
    if (title !== undefined) scheduleRename(info)
  }

  ctx.on('agent/created', async ({ agent }) => {
    try {
      await ensureSessionFolder(agent)
    } catch (error) {
      ctx.logger.warn('workspace-organizer: 初始化会话目录失败', error)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const disposer = sectionDisposers.get(agent.id)
    if (disposer !== undefined) {
      try { disposer() } catch {}
      sectionDisposers.delete(agent.id)
    }
    infos.delete(agent.id)
  })

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'session/title') return
    const info = infos.get(session.id)
    if (info === undefined) return
    info.title = event.data.title
    scheduleRename(info)
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!config.guardRootWrites) return next()
    if (exec.name !== 'write' || exec.agent === undefined) return next()
    const info = infos.get(exec.agent.id)
    if (info === undefined) return next()
    const args = exec.arguments
    if (args === null || typeof args !== 'object') return next()
    const filePath = args.file_path
    if (typeof filePath !== 'string' || filePath.trim() === '') return next()
    let cwd
    try {
      const session = ctx.sessions.get(exec.agent.id) ?? exec.agent.session
      cwd = ctx.workingDirectory.get(session)
    } catch {
      return next()
    }
    let absolute
    try {
      absolute = resolvePath(cwd, filePath)
    } catch {
      return next()
    }
    if (!samePath(dirname(absolute), info.workspacePath)) return next()
    if (ROOT_FILE_ALLOWLIST.has(basename(absolute).toLowerCase())) return next()
    if (await pathExists(absolute)) return next()
    exec.signal?.throwIfAborted()
    return {
      kind: 'ask',
      reason: `这次写入会在工作区根目录新建文件。建议放到本次会话的目录：${info.folderPath}`,
      displayReason: {
        en: `This creates a new file in the workspace root. Put new artifacts in the session folder instead: ${info.folderPath}`,
        zh: `这次写入会在工作区根目录新建文件。建议放到本次会话的目录：${info.folderPath}`,
      },
    }
  })

  /**
   * Human-readable label for one live agent.
   * @param agent live agent.
   * @returns title when known, otherwise the session id.
   */
  function sessionLabel (agent) {
    const title = agent?.session?.title ?? agent?.session?.header?.title
    if (typeof title === 'string' && title.trim() !== '') return `${title.trim()}（${agent.id}）`
    return String(agent?.id ?? '未知会话')
  }

  /**
   * Try to remove the abandoned source directory after a copy-style migration.
   * Deletion needs the same exclusivity a rename does, so a running DSH often
   * blocks it; the message then tells the user which condition applies.
   * @param path old workspace directory.
   * @returns a result line for the command output.
   */
  async function cleanupOldDirectory (path) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 })
      return `旧目录已自动删除：${path}`
    } catch (error) {
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      const where = (error !== null && typeof error === 'object' ? error.path : undefined) ?? path
      if (code === 'ENOENT') return `旧目录已不存在：${path}`
      if (isBusyError(error)) {
        return `旧目录未能自动删除：${where} 仍被 DSH 占用（可能已清理部分内容）。` +
          '完全退出 DSH 后再删除即可。'
      }
      if (code === 'EACCES') {
        return `旧目录未能自动删除：没有访问权限（${where}）。请检查文件权限后手动删除。`
      }
      if (code === 'ENOTEMPTY') {
        return `旧目录未能自动删除：仍有内容被占用（${where}）。退出 DSH 后重试。`
      }
      return `旧目录未能自动删除（${code ?? '未知错误'}）：${where}。请手动处理。`
    }
  }

  /**
   * List the live agents whose session cwd sits inside one workspace path.
   * @param workspacePath workspace root.
   * @returns matching agents.
   */
  function blockingAgentsOf (workspacePath) {
    const result = []
    for (const agent of ctx.agents.list()) {
      const cwd = agent.session?.header?.cwd
      if (typeof cwd === 'string' && isSameOrInside(workspacePath, cwd)) result.push(agent)
    }
    return result
  }

  /**
   * Strictly relocate one workspace: move files, rewrite every session log's
   * header cwd, move session log directories, then remove the old path.
   * @param input command payload.
   * @returns a human-readable result.
   */
  async function runRelocate (input) {
    const registry = ctx.workspaceRegistry
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
    if (workspaceId === '') throw new Error('缺少 workspaceId')
    const workspace = registry.get(workspaceId)
    if (workspace === undefined) throw new Error('工作区不存在，可能已在侧边栏删除')
    const oldPath = workspace.path
    const title = workspace.title
    const oldSessionIds = [...workspace.sessionIds]
    const list = registry.list()
    const oldIndex = list.findIndex((item) => item.id === workspaceId)
    const beforeId = oldIndex >= 0 ? list[oldIndex + 1]?.id : undefined
    const leafError = validateLeafName(input.name)
    if (leafError !== undefined) throw new Error(leafError)
    if (typeof input.targetParent !== 'string' || !isAbsolutePath(input.targetParent)) {
      throw new Error('目标父文件夹必须是绝对路径')
    }
    const targetParent = resolve(input.targetParent)
    if (!(await isDirectory(targetParent))) {
      throw new Error(`目标父文件夹不存在或不是目录：${targetParent}`)
    }
    const target = resolve(targetParent, input.name)
    const canonicalParent = await realpath(targetParent)
    const plannedTarget = join(canonicalParent, input.name)
    if (samePath(plannedTarget, oldPath) || samePath(target, oldPath)) {
      return '目标位置与当前工作区路径相同，无需移动。'
    }
    if (isSameOrInside(oldPath, target) || isSameOrInside(oldPath, plannedTarget)) {
      throw new Error('目标位置不能位于工作区内部')
    }
    if (isSameOrInside(target, oldPath) || isSameOrInside(plannedTarget, oldPath)) {
      throw new Error('目标位置不能是工作区的上级目录')
    }
    if (await pathExists(target) || await pathExists(plannedTarget)) {
      throw new Error(`目标位置已存在：${plannedTarget}`)
    }
    if (samePath(parse(oldPath).root, oldPath)) throw new Error('不能移动磁盘根目录')
    for (const other of list) {
      if (other.id === workspaceId) continue
      if (isInside(oldPath, other.path)) {
        throw new Error(`该工作区内还有另一个已注册工作区“${other.title}”，请先移动或删除它`)
      }
      if (isSameOrInside(other.path, plannedTarget)) {
        throw new Error(`目标位置位于另一个工作区“${other.title}”内部`)
      }
    }

    await assertSafePath(oldPath, '工作区路径')
    await assertSafePath(target, '目标位置', { mustExist: false })
    await assertSafePath(plannedTarget, '目标位置', { mustExist: false })

    const profileDir = profileDirOf()
    if (typeof profileDir !== 'string' || profileDir === '') {
      throw new Error('无法定位当前 profile，严格迁移需要检查本地插件依赖；请重启 DSH 后重试。')
    }
    let profile
    try {
      profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    } catch (error) {
      throw new Error(`无法读取 profile 的 package.json：${error instanceof Error ? error.message : String(error)}；严格迁移需要检查工作区内的插件链接。`)
    }
    const linked = []
    const oldCanonical = await realpath(oldPath)
    for (const [name, spec] of Object.entries(profile?.dependencies ?? {})) {
      if (typeof spec !== 'string') continue
      let local
      if (spec.startsWith('link:')) local = spec.slice('link:'.length)
      else if (spec.startsWith('file:')) local = spec.slice('file:'.length)
      if (local === undefined || local === '') continue
      let target
      try {
        target = isAbsolutePath(local) ? resolve(local) : resolve(profileDir, local)
      } catch {
        continue
      }
      let canonical
      try { canonical = await realpath(target) } catch { canonical = target }
      if (isSameOrInside(oldCanonical, canonical)) linked.push(`${name} → ${canonical}`)
    }
    if (linked.length > 0) {
      throw new Error(
        `该工作区内有 profile 的本地插件依赖：${linked.join('；')}。` +
        '严格迁移会删除旧路径，这些本地源码/安装包会失效。' +
        '请先把它们移到工作区外，并更新 profile 的依赖路径，再执行迁移。',
      )
    }

    const blockingAgents = blockingAgentsOf(oldPath)
    const forceClose = input.forceCloseBlockers === true
    if (blockingAgents.length > 0 && !forceClose) {
      throw new Error(
        `严格迁移要求目标工作区没有运行中的会话。请先切换到另一个工作区的会话再执行移动。` +
        `当前仍在运行：${blockingAgents.map((agent) => sessionLabel(agent)).join('、')}`,
      )
    }
    const forceStopped = []
    if (blockingAgents.length > 0) {
      // 用户确认强制关闭：先取消这些会话的当前工作并等它们停稳，
      // 让收件箱和日志落盘，然后按“复制日志”的方式处理（日志文件仍被占用，不能改名）。
      for (const agent of blockingAgents) {
        try { agent.cancel({ kind: 'user' }) } catch (error) {
          ctx.logger.warn(`workspace-organizer: 取消会话 ${agent.id} 失败`, error)
        }
      }
      for (const agent of blockingAgents) {
        try { await agent.whenIdle() } catch (error) {
          ctx.logger.warn(`workspace-organizer: 等待会话 ${agent.id} 停稳失败`, error)
        }
        try { await ctx.sessions.flush(agent.session) } catch {}
        forceStopped.push(agent.id)
      }
    }

    if (config.sessionsRoot === '' || !(await isDirectory(config.sessionsRoot))) {
      throw new Error(`找不到会话日志根目录（${config.sessionsRoot || 'DSH_HOME 未设置'}）；严格迁移需要改写会话日志的 cwd。`)
    }
    const oldProjectDir = join(config.sessionsRoot, sessionProjectKey(oldPath))
    const logSessions = await scanProjectSessions(oldProjectDir, oldPath)

    const previousCwd = process.cwd()
    const cwdInside = isSameOrInside(oldPath, previousCwd)
    if (cwdInside && !sameRoot(oldPath, plannedTarget)) {
      throw new Error('当前工作区是 DSH 的工作目录，暂不支持跨磁盘严格迁移。请把目标选在同一磁盘，或从其他目录启动 DSH 后再试。')
    }

    let cwdChanged = false
    let succeeded = false
    let relocated
    let copiedInstead = false
    let canonicalTarget
    let newWorkspace
    let deleteError
    let backupWarning
    const rewritten = []
    const movedDirs = []
    const copiedDirs = []
    let pendingWritten = false

    try {
      if (cwdInside) {
        process.chdir(os.tmpdir())
        cwdChanged = true
      }
      try {
        relocated = await relocateDirectory(oldPath, target)
      } catch (error) {
        if (!isBusyError(error)) throw error
        // Windows 上旧目录被 DSH 等进程打开时无法重命名；复制不受句柄限制，
        // 因此降级为复制迁移，旧目录原样保留，由用户确认后自行删除。
        ctx.logger.warn('workspace-organizer: 旧目录被占用，改为复制迁移（保留旧目录）', error)
        relocated = await copyDirectoryKeepingSource(oldPath, target)
        copiedInstead = true
      }
      canonicalTarget = await realpath(target)
      const newProjectDir = join(config.sessionsRoot, sessionProjectKey(canonicalTarget))

      const forceStoppedIds = new Set(forceStopped)
      for (const record of logSessions) {
        if (forceStoppedIds.has(record.id)) {
          // 被强制停止的会话仍持有旧日志写句柄：复制目录，只改写副本的 header，
          // 旧日志原样保留，重启 DSH 后由新位置接管。
          const destination = await copySessionDir(record.dir, newProjectDir)
          copiedDirs.push(destination)
          const copiedLog = await findCurrentLogFile(destination)
          if (copiedLog !== undefined) await rewriteLogCwd(copiedLog, canonicalTarget)
          continue
        }
        const token = await rewriteLogCwd(record.file, canonicalTarget)
        rewritten.push(token)
        if (!samePath(oldProjectDir, newProjectDir)) {
          const destination = await moveSessionDir(record.dir, newProjectDir)
          movedDirs.push({ from: record.dir, to: destination })
        }
      }

      newWorkspace = await registry.create(canonicalTarget, title)
      const allSessionIds = [...new Set([...oldSessionIds, ...logSessions.map((record) => record.id)])]
      if (allSessionIds.length > 0) {
        const existing = await readPendingAttach()
        await writePendingAttach([
          ...existing.filter((entry) => entry.workspaceId !== newWorkspace.id),
          {
            workspaceId: newWorkspace.id,
            workspacePath: canonicalTarget,
            sessionIds: allSessionIds,
            createdAt: new Date().toISOString(),
          },
        ])
        pendingWritten = true
      }
      const attachFailures = []
      for (const sessionId of [...allSessionIds].reverse()) {
        try {
          await newWorkspace.attachSession(sessionId)
        } catch (error) {
          attachFailures.push({ sessionId, error })
        }
      }
      try {
        await registry.insertBefore(newWorkspace.id, beforeId)
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 无法恢复工作区排序', error)
      }
      try {
        await registry.delete(workspaceId)
      } catch (error) {
        deleteError = error
        ctx.logger.warn('workspace-organizer: 无法删除旧工作区记录', error)
      }
      succeeded = true

      if (pendingWritten && attachFailures.length === 0) {
        try {
          const current = await readPendingAttach()
          await writePendingAttach(current.filter((entry) => entry.workspaceId !== newWorkspace.id))
        } catch (error) {
          ctx.logger.warn('workspace-organizer: 无法清理待归属记录', error)
        }
      }
      if (attachFailures.length > 0) {
        // The fresh workspace may not accept its sessions immediately; retry in
        // this process instead of telling the user a restart is mandatory.
        schedulePendingAttach(0)
      }

      try {
        if (samePath(ctx.sandboxPolicy.workspaceRoot, oldPath)) {
          ctx.sandboxPolicy.workspaceRoot = canonicalTarget
        }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 无法更新沙箱回退根目录', error)
      }

      for (const info of infos.values()) {
        if (!samePath(info.workspacePath, oldPath)) continue
        info.folderPath = remapPath(info.folderPath, oldPath, canonicalTarget)
        info.workspacePath = canonicalTarget
      }

      if (relocated.backup !== undefined) {
        try {
          await rm(relocated.backup, { recursive: true, force: true })
        } catch (error) {
          backupWarning = error
          ctx.logger.warn(`workspace-organizer: 旧数据备份未能删除：${relocated.backup}`, error)
        }
      }

      if (!samePath(oldProjectDir, newProjectDir)) {
        try {
          await rmdir(oldProjectDir)
        } catch {
          // Remaining sessions with a different cwd may share the directory; leave it.
        }
      }

      const lines = [
        copiedInstead
          ? `已迁移工作区“${title}”（旧目录被占用，已改用复制模式）`
          : `已严格迁移工作区“${title}”`,
        `新路径：${canonicalTarget}`,
        `会话日志：已改写 ${rewritten.length} 个 header cwd${movedDirs.length > 0 ? `，已移动 ${movedDirs.length} 个会话目录` : ''}${copiedDirs.length > 0 ? `，已复制 ${copiedDirs.length} 个被强制停止会话的目录` : ''}。`,
        `已立即重新关联 ${allSessionIds.length - attachFailures.length} 个会话。`,
      ]
      if (forceStopped.length > 0) {
        lines.push(`已强制停止 ${forceStopped.length} 个会话（${forceStopped.join('、')}），它们的日志已复制到新位置；重启 DSH 后从新路径继续。`)
      }
      if (copiedInstead || forceStopped.length > 0) {
        lines.push(`旧路径：${oldPath}`)
      }
      if (!copiedInstead) {
        lines.push('旧目录已随重命名移除。')
      }
      if (succeeded) {
        // 复制模式会遗留旧目录：这里判断能否直接删除，并按原因给出结论。
        if (await pathExists(oldPath)) {
          const stillLive = blockingAgentsOf(oldPath)
          if (stillLive.length > 0) {
            lines.push(`旧目录未能自动删除：DSH 里仍有 ${stillLive.length} 个会话在使用它（${stillLive.map((agent) => sessionLabel(agent)).join('、')}）。完全退出 DSH 后再删除即可。`)
          } else {
            lines.push(await cleanupOldDirectory(oldPath))
          }
        }
      }
      if (attachFailures.length > 0) {
        lines.push(`有 ${attachFailures.length} 个会话将在重启 DSH 后自动归位。`)
      }
      lines.push('请重启 DSH 以刷新会话列表和服务缓存。')
      if (cwdInside) {
        lines.push('DSH 进程的工作目录已切到新路径；如果桌面快捷方式的启动目录是旧路径，请改为新路径。')
      }
      if (deleteError !== undefined) {
        lines.push('旧工作区记录未能删除，已保留；可在侧边栏手动删除。')
      }
      if (backupWarning !== undefined) {
        lines.push(`旧数据备份未能删除：${relocated.backup}（可手动删除）。`)
      }
      return lines.join('\n')
    } catch (error) {
      if (succeeded) throw error
      if (pendingWritten && newWorkspace !== undefined) {
        try {
          const current = await readPendingAttach()
          await writePendingAttach(current.filter((entry) => entry.workspaceId !== newWorkspace.id))
        } catch {}
      }
      if (newWorkspace !== undefined) {
        try { await registry.delete(newWorkspace.id) } catch (cleanupError) {
          ctx.logger.warn('workspace-organizer: 回滚新工作区记录失败', cleanupError)
        }
      }
      for (const moved of [...movedDirs].reverse()) {
        try {
          await mkdir(dirname(moved.from), { recursive: true })
          await rename(moved.to, moved.from)
        } catch (cleanupError) {
          ctx.logger.warn(`workspace-organizer: 回滚会话日志目录失败 ${moved.to} -> ${moved.from}`, cleanupError)
        }
      }
      for (const dir of copiedDirs) {
        try { await rm(dir, { recursive: true, force: true }) } catch (cleanupError) {
          ctx.logger.warn(`workspace-organizer: 回滚复制的会话目录失败 ${dir}`, cleanupError)
        }
      }
      for (const token of [...rewritten].reverse()) {
        try {
          await restoreLogHeader(token)
        } catch (cleanupError) {
          ctx.logger.warn(`workspace-organizer: 回滚会话日志 cwd 失败 ${token.file}`, cleanupError)
        }
      }
      if (relocated !== undefined) {
        try {
          await rollbackRelocate(relocated, oldPath, target)
        } catch (cleanupError) {
          ctx.logger.error('workspace-organizer: 文件回滚失败，请检查两个路径', cleanupError)
          throw new Error(`移动失败且自动回滚未完成：${error instanceof Error ? error.message : String(error)}；请检查 ${oldPath} 与 ${target}`)
        }
      }
      if (error !== null && typeof error === 'object' && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        throw new Error(
          '目录仍被占用，迁移未完成（重命名与复制降级都未能完成）。' +
          '请关闭该工作区的终端、文件预览和正在运行的任务后重试；仍然失败时先退出 DSH 再试。',
        )
      }
      throw error
    } finally {
      if (cwdChanged) {
        let restore = os.tmpdir()
        if (succeeded && canonicalTarget !== undefined) {
          restore = remapPath(previousCwd, oldPath, canonicalTarget)
        } else if (await pathExists(oldPath)) {
          restore = previousCwd
        } else if (canonicalTarget !== undefined && await pathExists(canonicalTarget)) {
          restore = remapPath(previousCwd, oldPath, canonicalTarget)
        }
        try {
          process.chdir(restore)
        } catch {
          if (canonicalTarget !== undefined) {
            try { process.chdir(canonicalTarget) } catch {}
          }
        }
      }
    }
  }

  /**
   * Move one inactive session to another registered workspace.
   * @param input command payload.
   * @param carrierSessionId session running this command.
   * @returns a human-readable result.
   */
  async function runSessionRelocate (input, carrierSessionId, details) {
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const targetWorkspaceId = typeof input.targetWorkspaceId === 'string' ? input.targetWorkspaceId : ''
    const sessionTitle = typeof input.sessionTitle === 'string' && input.sessionTitle.trim() !== ''
      ? input.sessionTitle.trim()
      : sessionId
    if (sessionId === '') throw new Error('缺少 sessionId')
    if (targetWorkspaceId === '') throw new Error('缺少 targetWorkspaceId')
    if (sessionId === carrierSessionId) {
      throw new Error('承载这次操作的会话不能移动自己；请切换到另一个会话，或者在未运行该会话时再移动。')
    }
    const live = ctx.agents.get(sessionId)
    if (live !== undefined) {
      throw new Error(`目标会话正在运行（${sessionLabel(live)}），请先切换离开或关闭它，再执行移动。`)
    }
    if (config.sessionsRoot === '' || !(await isDirectory(config.sessionsRoot))) {
      throw new Error(`找不到会话日志根目录（${config.sessionsRoot || 'DSH_HOME 未设置'}）；移动会话需要改写其日志 cwd。`)
    }
    let snapshot
    try {
      snapshot = await ctx.sessionPersistence.stat(sessionId)
    } catch (error) {
      throw new Error(`无法读取会话日志：${error instanceof Error ? error.message : String(error)}`)
    }
    const header = snapshot?.header
    if (header === undefined) throw new Error('找不到该会话的持久化 header，可能尚未落盘；先打开一次再试。')
    if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
      throw new Error('子会话不能单独移动；请移动它的父会话。')
    }
    const sourcePath = header.cwd
    if (typeof sourcePath !== 'string' || sourcePath === '') throw new Error('该会话没有记录 cwd，无法确定它当前属于哪个工作区。')
    let sourceWorkspace
    try {
      sourceWorkspace = await ctx.workspaceRegistry.resolveByPath(sourcePath)
    } catch {
      sourceWorkspace = undefined
    }
    if (sourceWorkspace === undefined) throw new Error(`会话当前 cwd 不属于任何已注册工作区：${sourcePath}`)
    const targetWorkspace = ctx.workspaceRegistry.get(targetWorkspaceId)
    if (targetWorkspace === undefined) throw new Error('目标工作区不存在，可能已被删除')
    if (sourceWorkspace.id === targetWorkspace.id) throw new Error('目标工作区与当前工作区相同')
    if (!(await isDirectory(targetWorkspace.path))) throw new Error(`目标工作区目录不存在：${targetWorkspace.path}`)
    await assertSafePath(sourceWorkspace.path, '会话源工作区')
    await assertSafePath(targetWorkspace.path, '目标工作区')

    let sourceProjectDir = join(config.sessionsRoot, sessionProjectKey(sourcePath))
    let records = await scanProjectSessions(sourceProjectDir, sourcePath)
    let record = records.find((entry) => entry.id === sessionId)
    if (record === undefined && !samePath(sourceWorkspace.path, sourcePath)) {
      const alternateDir = join(config.sessionsRoot, sessionProjectKey(sourceWorkspace.path))
      const alternate = await scanProjectSessions(alternateDir, sourcePath)
      const alternateRecord = alternate.find((entry) => entry.id === sessionId)
      if (alternateRecord !== undefined) {
        sourceProjectDir = alternateDir
        record = alternateRecord
      }
    }
    if (record === undefined) throw new Error(`未找到该会话的日志目录：${sessionId}（可能尚未落盘，先打开一次再试）`)
    const newProjectDir = join(config.sessionsRoot, sessionProjectKey(targetWorkspace.path))
    const sourceSessionsDir = join(sourceWorkspace.path, config.sessionsDirName)
    const targetSessionsDir = join(targetWorkspace.path, config.sessionsDirName)

    let writtenPaths = []
    let writtenPathsError
    try {
      writtenPaths = await collectSessionWrittenPaths(record.dir)
    } catch (error) {
      writtenPathsError = error
      ctx.logger.warn('workspace-organizer: 读取会话写入文件记录失败', error)
    }

    const token = await rewriteLogCwd(record.file, targetWorkspace.path)
    let movedLog
    try {
      if (!samePath(sourceProjectDir, newProjectDir)) {
        movedLog = await moveSessionDir(record.dir, newProjectDir)
      }
    } catch (error) {
      try { await restoreLogHeader(token) } catch {}
      throw new Error(`已改写会话日志但移动日志目录失败：${error instanceof Error ? error.message : String(error)}`)
    }

    // From this point the durable log already points at the target workspace.
    // Record the attachment before any further failure can strand it.
    await mergePendingAttach(targetWorkspace.id, targetWorkspace.path, [sessionId])

    let folderFrom
    let folderTo
    let folderNote
    try {
      const folder = await findSessionFolder(sourceSessionsDir, sessionId)
      if (folder === undefined) {
        folderNote = '该会话没有带 .dsh-session 标记的 sessions/ 专属目录；为避免误移，不处理未标记目录'
      } else {
        await mkdir(targetSessionsDir, { recursive: true })
        const leaf = await uniqueChildName(targetSessionsDir, basename(folder))
        const targetFolder = join(targetSessionsDir, leaf)
        let relocation
        try {
          // Prefer a real move: same-volume rename keeps every nested file,
          // and cross-volume relocation copies with verification before the
          // source is detached.
          relocation = await relocateDirectory(folder, targetFolder)
        } catch (error) {
          // A process may still hold the folder. Keep the files available in
          // the target workspace instead of leaving the session without them.
          await copyDirectoryKeepingSource(folder, targetFolder)
          folderFrom = folder
          folderTo = targetFolder
          folderNote = `会话文件夹及其中文件已复制到新工作区；旧目录暂时无法删除：${folder}（${error instanceof Error ? error.message : String(error)}）`
        }
        if (relocation !== undefined) {
          folderFrom = folder
          folderTo = targetFolder
          if (relocation.backup !== undefined) {
            try {
              await rm(relocation.backup, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 })
            } catch {
              folderNote = `会话文件夹及其中文件已移动；旧备份未能删除：${relocation.backup}`
            }
          }
          if (folderNote === undefined) folderNote = '会话文件夹及其中文件已移动'
        }
        const marker = (await readSessionMarker(folderTo)) ?? {}
        marker.sessionId = sessionId
        marker.workspacePath = targetWorkspace.path
        marker.updatedAt = new Date().toISOString()
        await writeSessionMarker(folderTo, marker)
      }
    } catch (error) {
      folderNote = `会话文件夹及其中文件移动失败（会话归属仍会变更）：${error instanceof Error ? error.message : String(error)}`
    }

    const writtenMoved = []
    const writtenConflicts = []
    const writtenFailed = []
    const writtenKept = []
    let writtenSkipped = 0
    for (const raw of writtenPaths) {
      let sourceFile
      try {
        sourceFile = isAbsolutePath(raw) ? resolve(raw) : resolve(sourceWorkspace.path, raw)
      } catch {
        writtenFailed.push(`${raw}: 路径无效`)
        continue
      }
      if (!isInside(sourceWorkspace.path, sourceFile)) {
        writtenSkipped += 1
        continue
      }
      if (isInside(sourceSessionsDir, sourceFile)) {
        writtenSkipped += 1
        continue
      }
      const rel = relative(sourceWorkspace.path, sourceFile)
      if (rel === '' || rel.startsWith('..') || isAbsolutePath(rel)) {
        writtenSkipped += 1
        continue
      }
      let info
      try {
        info = await stat(sourceFile)
      } catch {
        writtenSkipped += 1
        continue
      }
      if (!info.isFile()) {
        writtenSkipped += 1
        continue
      }
      let realSource
      let realRoot
      try {
        realSource = await realpath(sourceFile)
        realRoot = await realpath(sourceWorkspace.path)
      } catch {
        writtenSkipped += 1
        continue
      }
      if (!isInside(realRoot, realSource)) {
        writtenSkipped += 1
        continue
      }
      const targetFile = join(targetWorkspace.path, rel)
      if (await pathExists(targetFile)) {
        writtenConflicts.push(rel)
        continue
      }
      try {
        await mkdir(dirname(targetFile), { recursive: true })
        const mode = await moveWrittenFile(sourceFile, targetFile)
        if (mode === 'copy-keep') writtenKept.push(rel)
        writtenMoved.push(rel)
      } catch (error) {
        writtenFailed.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const sourceTitle = sourceWorkspace.title || sourceWorkspace.path
    const targetTitle = targetWorkspace.title || targetWorkspace.path
    let attached = false
    let attachError
    try {
      await targetWorkspace.attachSession(sessionId)
      attached = true
    } catch (error) {
      attachError = error
      ctx.logger.warn('workspace-organizer: 会话暂时无法挂到目标工作区', error)
    }
    let detached = false
    let detachError
    try {
      await sourceWorkspace.detachSession(sessionId)
      detached = true
    } catch (error) {
      detachError = error
      ctx.logger.warn('workspace-organizer: 无法从旧工作区移除会话', error)
    }
    if (attached) {
      try { await removePendingSession(targetWorkspace.id, sessionId) } catch {}
    } else {
      schedulePendingAttach(0)
    }

    if (movedLog !== undefined && !samePath(sourceProjectDir, newProjectDir)) {
      try { await rmdir(sourceProjectDir) } catch {
        // Other sessions with a different cwd may share the project directory.
      }
    }

    const lines = [
      `已把会话“${sessionTitle}”从“${sourceTitle}”移动到“${targetTitle}”`,
      `原工作区：${sourceTitle}（${sourcePath}）`,
      `新工作区：${targetTitle}（${targetWorkspace.path}）`,
      `会话日志：已改写 header cwd${movedLog !== undefined ? '，日志目录已移动到新的 --cwd-- 目录' : '（日志目录无需移动）'}。`,
      `会话文件夹及其中文件：${folderTo !== undefined ? `已移动到 ${folderTo}` : folderNote}`,
      writtenPathsError !== undefined
        ? `会话在 sessions/ 之外写到工作区的文件：读取记录失败（${writtenPathsError instanceof Error ? writtenPathsError.message : String(writtenPathsError)}）`
        : (writtenPaths.length === 0
            ? '会话在 sessions/ 之外写到工作区的文件：没有 write/edit 记录'
            : `会话在 sessions/ 之外写到工作区的文件：记录 ${writtenPaths.length} 个，移动 ${writtenMoved.length} 个${writtenConflicts.length > 0 ? `，同名未覆盖 ${writtenConflicts.length} 个` : ''}${writtenFailed.length > 0 ? `，失败 ${writtenFailed.length} 个` : ''}${writtenSkipped > 0 ? `，跳过 ${writtenSkipped} 个（源工作区外、sessions/ 内或已不存在）` : ''}`),
      attached ? '会话归属：已立即挂到目标工作区。' : '会话归属：目标工作区暂未接收，已写入待归属记录，重启 DSH 后自动归位。',
      '请重启 DSH 刷新会话列表和服务缓存。',
    ]
    if (writtenConflicts.length > 0) {
      lines.push(`目标已存在同名文件，未覆盖：${writtenConflicts.slice(0, 10).join('、')}${writtenConflicts.length > 10 ? ` 等 ${writtenConflicts.length} 个` : ''}`)
    }
    if (writtenFailed.length > 0) {
      lines.push(`会话写入文件移动失败：${writtenFailed.slice(0, 10).join('；')}${writtenFailed.length > 10 ? ` 等 ${writtenFailed.length} 个` : ''}`)
    }
    if (writtenKept.length > 0) {
      lines.push(`已复制但源文件被占用未删除：${writtenKept.slice(0, 10).join('、')}${writtenKept.length > 10 ? ` 等 ${writtenKept.length} 个` : ''}`)
    }
    if (folderFrom !== undefined && folderTo !== undefined && folderNote !== undefined && folderNote.includes('旧目录')) {
      lines.push(`旧会话目录仍在：${folderFrom}，确认新目录完整后可手动删除。`)
    }
    if (folderFrom !== undefined && folderTo !== undefined && folderNote !== undefined && folderNote.includes('旧备份')) {
      lines.push(`旧会话备份仍在：${folderNote.replace(/^.*旧备份未能删除：/, '')}，确认新目录完整后可手动删除。`)
    }
    if (!detached) lines.push('旧工作区记录里的会话计数可能暂时未清理，重启 DSH 后会自动重新计算。')
    if (attachError !== undefined) lines.push(`目标工作区暂时未挂上的原因：${attachError instanceof Error ? attachError.message : String(attachError)}`)
    if (detachError !== undefined) lines.push(`旧工作区移除会话失败的原因：${detachError instanceof Error ? detachError.message : String(detachError)}`)
    lines.push('如果该会话曾手动改过工作目录（working/directory 事件），重启后请在会话里重新设置一次。')
    if (details !== null && typeof details === 'object') {
      details.writtenMoved = writtenMoved.length
      details.writtenConflicts = writtenConflicts.length
      details.writtenFailed = writtenFailed.length
      details.writtenSkipped = writtenSkipped
      details.folderMoved = folderTo !== undefined
    }
    return lines.join('\n')
  }

  /**
   * Move several inactive sessions to one target workspace, one by one.
   * @param input command payload.
   * @param carrierSessionId session running this command.
   * @returns a per-session summary.
   */
  async function runSessionRelocateBatch (input, carrierSessionId, signal) {
    const targetWorkspaceId = typeof input.targetWorkspaceId === 'string' ? input.targetWorkspaceId : ''
    if (targetWorkspaceId === '') throw new Error('缺少 targetWorkspaceId')
    const targetWorkspace = ctx.workspaceRegistry.get(targetWorkspaceId)
    if (targetWorkspace === undefined) throw new Error('目标工作区不存在，可能已被删除')
    const ids = [...new Set((Array.isArray(input.sessionIds) ? input.sessionIds : [])
      .filter((id) => typeof id === 'string' && id !== ''))]
    if (ids.length === 0) throw new Error('请至少选择一个会话')
    if (ids.length > 100) throw new Error('一次最多移动 100 个会话；请分批操作')
    const titles = input.sessionTitles !== null && typeof input.sessionTitles === 'object' && !Array.isArray(input.sessionTitles)
      ? input.sessionTitles
      : {}
    const successes = []
    const failures = []
    for (const sessionId of ids) {
      signal?.throwIfAborted()
      const title = typeof titles[sessionId] === 'string' && titles[sessionId].trim() !== ''
        ? titles[sessionId].trim()
        : sessionId
      try {
        const details = {}
        await runSessionRelocate({ sessionId, targetWorkspaceId, sessionTitle: title }, carrierSessionId, details)
        successes.push({ sessionId, title, details })
      } catch (error) {
        failures.push({
          sessionId,
          title,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const lines = [`批量移动会话：共 ${ids.length} 个，成功 ${successes.length} 个，失败 ${failures.length} 个。`]
    if (successes.length > 0) {
      lines.push('成功：')
      for (const success of successes) {
        const parts = []
        if (typeof success.details?.writtenMoved === 'number' && success.details.writtenMoved > 0) {
          parts.push(`外部文件移动 ${success.details.writtenMoved} 个`)
        }
        if (typeof success.details?.writtenConflicts === 'number' && success.details.writtenConflicts > 0) {
          parts.push(`同名未覆盖 ${success.details.writtenConflicts} 个`)
        }
        if (typeof success.details?.writtenFailed === 'number' && success.details.writtenFailed > 0) {
          parts.push(`文件失败 ${success.details.writtenFailed} 个`)
        }
        lines.push(`- ${success.title}${parts.length > 0 ? `（${parts.join('，')}）` : ''}`)
      }
    }
    if (failures.length > 0) {
      lines.push('失败：')
      for (const failure of failures) lines.push(`- ${failure.title}：${failure.message}`)
    }
    if (successes.length > 0) lines.push('请重启 DSH 刷新会话列表和服务缓存。')
    return lines.join('\n')
  }

  /**
   * Permanently delete one inactive session: its log directory, its
   * sessions/<date>_<title>/ folder and optionally the files it wrote outside
   * that folder.
   * @param input command payload.
   * @param carrierSessionId session running this command.
   * @returns a human-readable result.
   */
  async function runSessionDelete (input, carrierSessionId) {
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const sessionTitle = typeof input.sessionTitle === 'string' && input.sessionTitle.trim() !== ''
      ? input.sessionTitle.trim()
      : sessionId
    const deleteWrittenFiles = input.deleteWrittenFiles === true
    if (sessionId === '') throw new Error('缺少 sessionId')
    if (sessionId === carrierSessionId) {
      throw new Error('承载这次操作的会话不能删除自己；请切换到另一个会话再删除。')
    }
    const live = ctx.agents.get(sessionId)
    if (live !== undefined) {
      throw new Error(`目标会话正在运行（${sessionLabel(live)}），请先切换离开或关闭它，再删除。`)
    }
    if (config.sessionsRoot === '' || !(await isDirectory(config.sessionsRoot))) {
      throw new Error(`找不到会话日志根目录（${config.sessionsRoot || 'DSH_HOME 未设置'}）`)
    }
    let snapshot
    try {
      snapshot = await ctx.sessionPersistence.stat(sessionId)
    } catch (error) {
      throw new Error(`无法读取会话日志：${error instanceof Error ? error.message : String(error)}`)
    }
    const header = snapshot?.header
    if (header === undefined) throw new Error('找不到该会话的持久化 header，可能已经删除。')
    if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
      throw new Error('子会话不能单独删除；请删除它的父会话。')
    }
    const sourcePath = header.cwd
    if (typeof sourcePath !== 'string' || sourcePath === '') throw new Error('该会话没有记录 cwd，无法定位它的文件。')
    let sourceWorkspace
    try {
      sourceWorkspace = await ctx.workspaceRegistry.resolveByPath(sourcePath)
    } catch {
      sourceWorkspace = undefined
    }
    const sourceWorkspacePath = sourceWorkspace?.path ?? sourcePath
    if (!(await isDirectory(sourceWorkspacePath))) throw new Error(`会话工作区目录不存在：${sourceWorkspacePath}`)
    await assertSafePath(sourceWorkspacePath, '会话工作区')

    let sourceProjectDir = join(config.sessionsRoot, sessionProjectKey(sourcePath))
    let records = await scanProjectSessions(sourceProjectDir, sourcePath)
    let record = records.find((entry) => entry.id === sessionId)
    if (record === undefined && !samePath(sourceWorkspacePath, sourcePath)) {
      const alternateDir = join(config.sessionsRoot, sessionProjectKey(sourceWorkspacePath))
      const alternate = await scanProjectSessions(alternateDir, sourcePath)
      const alternateRecord = alternate.find((entry) => entry.id === sessionId)
      if (alternateRecord !== undefined) {
        sourceProjectDir = alternateDir
        record = alternateRecord
      }
    }
    if (record === undefined) throw new Error(`未找到该会话的日志目录：${sessionId}`)

    const sourceSessionsDir = join(sourceWorkspacePath, config.sessionsDirName)
    const folder = await findSessionFolder(sourceSessionsDir, sessionId)
    let folderDeleted = false
    if (folder !== undefined) {
      if (!isInside(sourceSessionsDir, folder)) throw new Error(`拒绝删除不在 sessions/ 内的路径：${folder}`)
      await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      folderDeleted = true
    }

    let writtenDeleted = 0
    let writtenSkipped = 0
    let writtenError
    const writtenFailed = []
    if (deleteWrittenFiles) {
      let writtenPaths = []
      try {
        writtenPaths = await collectSessionWrittenPaths(record.dir)
      } catch (error) {
        writtenError = error
        ctx.logger.warn('workspace-organizer: 读取会话写入文件记录失败', error)
      }
      for (const raw of writtenPaths) {
        let sourceFile
        try {
          sourceFile = isAbsolutePath(raw) ? resolve(raw) : resolve(sourceWorkspacePath, raw)
        } catch {
          writtenFailed.push(`${raw}: 路径无效`)
          continue
        }
        if (!isInside(sourceWorkspacePath, sourceFile)) {
          writtenSkipped += 1
          continue
        }
        if (isInside(sourceSessionsDir, sourceFile)) {
          writtenSkipped += 1
          continue
        }
        const rel = relative(sourceWorkspacePath, sourceFile)
        if (rel === '' || rel.startsWith('..') || isAbsolutePath(rel)) {
          writtenSkipped += 1
          continue
        }
        let info
        try {
          info = await stat(sourceFile)
        } catch {
          writtenSkipped += 1
          continue
        }
        if (!info.isFile()) {
          writtenSkipped += 1
          continue
        }
        let realSource
        let realRoot
        try {
          realSource = await realpath(sourceFile)
          realRoot = await realpath(sourceWorkspacePath)
        } catch {
          writtenSkipped += 1
          continue
        }
        if (!isInside(realRoot, realSource)) {
          writtenSkipped += 1
          continue
        }
        try {
          await rm(sourceFile, { force: true })
          writtenDeleted += 1
        } catch (error) {
          writtenFailed.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    await rm(record.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
    try { await rmdir(sourceProjectDir) } catch {}

    try { await removePendingSessionEverywhere(sessionId) } catch {}
    let detached = false
    let detachError
    if (sourceWorkspace !== undefined) {
      try {
        await sourceWorkspace.detachSession(sessionId)
        detached = true
      } catch (error) {
        detachError = error
        ctx.logger.warn('workspace-organizer: 删除会话时从工作区移除失败', error)
      }
    }

    const sourceTitle = sourceWorkspace !== undefined
      ? (sourceWorkspace.title || sourceWorkspace.path)
      : sourcePath
    const lines = [
      `已删除会话“${sessionTitle}”`,
      sourceWorkspace !== undefined
        ? `工作区：${sourceTitle}（${sourceWorkspace.path}）`
        : `原工作区路径：${sourcePath}（工作区记录已不存在）`,
      `会话日志目录：已删除（${record.dir}）`,
      `sessions/ 专属目录及其中文件：${folderDeleted ? `已删除（${folder}）` : '没有找到带 .dsh-session 标记的目录（未标记目录不会自动删除）'}`,
      deleteWrittenFiles
        ? `会话在 sessions/ 之外写到工作区的文件：删除 ${writtenDeleted} 个${writtenSkipped > 0 ? `，跳过 ${writtenSkipped} 个（源工作区外、sessions/ 内或已不存在）` : ''}`
        : '会话在 sessions/ 之外写到工作区的文件：未勾选删除，已保留',
      detached ? '工作区归属：已移除。' : '工作区归属：移除失败，重启 DSH 后请在侧边栏手动处理。',
      '请重启 DSH 刷新会话列表和缓存。',
    ]
    if (writtenError !== undefined) {
      lines.push(`读取会话写入文件记录失败，未删除外部文件：${writtenError instanceof Error ? writtenError.message : String(writtenError)}`)
    }
    if (writtenFailed.length > 0) {
      lines.push(`外部文件删除失败：${writtenFailed.slice(0, 10).join('；')}${writtenFailed.length > 10 ? ` 等 ${writtenFailed.length} 个` : ''}`)
    }
    if (detachError !== undefined) {
      lines.push(`工作区移除失败原因：${detachError instanceof Error ? detachError.message : String(detachError)}`)
    }
    return lines.join('\n')
  }

  /**
   * Describe exactly what a delete would remove, without deleting anything.
   * @param input command payload.
   * @param carrierSessionId session running this command.
   * @returns JSON text with the summary and a one-time confirmation token.
   */
  async function runSessionDeletePreview (input, carrierSessionId) {
    const ids = [...new Set((Array.isArray(input.sessionIds) ? input.sessionIds : [])
      .filter((id) => typeof id === 'string' && id !== ''))]
    if (ids.length === 0) throw new Error('请至少选择一个会话')
    if (ids.length > 100) throw new Error('一次最多预览 100 个会话')
    const deleteWrittenFiles = input.deleteWrittenFiles === true
    const titles = input.sessionTitles !== null && typeof input.sessionTitles === 'object' && !Array.isArray(input.sessionTitles)
      ? input.sessionTitles
      : {}
    const entries = []
    for (const sessionId of ids) {
      if (sessionId === carrierSessionId) {
        throw new Error('承载这次操作的会话不能删除自己；请切换到另一个会话再删除。')
      }
      const live = ctx.agents.get(sessionId)
      if (live !== undefined) {
        throw new Error(`目标会话正在运行（${sessionLabel(live)}），请先切换离开或关闭它，再删除。`)
      }
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      if (header === undefined) throw new Error(`找不到会话 header：${sessionId}`)
      if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
        throw new Error('子会话不能单独删除；请删除它的父会话。')
      }
      const sourcePath = header.cwd
      if (typeof sourcePath !== 'string' || sourcePath === '') throw new Error('该会话没有记录 cwd')
      let sourceWorkspace
      try { sourceWorkspace = await ctx.workspaceRegistry.resolveByPath(sourcePath) } catch { sourceWorkspace = undefined }
      const sourceWorkspacePath = sourceWorkspace?.path ?? sourcePath
      if (!(await isDirectory(sourceWorkspacePath))) throw new Error(`会话工作区目录不存在：${sourceWorkspacePath}`)
      await assertSafePath(sourceWorkspacePath, '会话工作区')
      let sourceProjectDir = join(config.sessionsRoot, sessionProjectKey(sourcePath))
      let records = await scanProjectSessions(sourceProjectDir, sourcePath)
      let record = records.find((entry) => entry.id === sessionId)
      if (record === undefined && !samePath(sourceWorkspacePath, sourcePath)) {
        const alternateDir = join(config.sessionsRoot, sessionProjectKey(sourceWorkspacePath))
        const alternate = await scanProjectSessions(alternateDir, sourcePath)
        const alternateRecord = alternate.find((entry) => entry.id === sessionId)
        if (alternateRecord !== undefined) {
          sourceProjectDir = alternateDir
          record = alternateRecord
        }
      }
      if (record === undefined) throw new Error(`未找到该会话的日志目录：${sessionId}`)
      const sourceSessionsDir = join(sourceWorkspacePath, config.sessionsDirName)
      const folder = await findSessionFolder(sourceSessionsDir, sessionId)
      const title = typeof titles[sessionId] === 'string' && titles[sessionId].trim() !== ''
        ? titles[sessionId].trim()
        : sessionId
      let files = []
      let skipped = 0
      let writtenError
      if (deleteWrittenFiles) {
        let writtenPaths = []
        try {
          writtenPaths = await collectSessionWrittenPaths(record.dir)
        } catch (error) {
          writtenError = error
        }
        for (const raw of writtenPaths) {
          let sourceFile
          try {
            sourceFile = isAbsolutePath(raw) ? resolve(raw) : resolve(sourceWorkspacePath, raw)
          } catch {
            skipped += 1
            continue
          }
          if (!isInside(sourceWorkspacePath, sourceFile) || isInside(sourceSessionsDir, sourceFile)) {
            skipped += 1
            continue
          }
          const rel = relative(sourceWorkspacePath, sourceFile)
          if (rel === '' || rel.startsWith('..') || isAbsolutePath(rel)) {
            skipped += 1
            continue
          }
          let info
          try { info = await stat(sourceFile) } catch { skipped += 1; continue }
          if (!info.isFile()) { skipped += 1; continue }
          let realSource
          let realRoot
          try {
            realSource = await realpath(sourceFile)
            realRoot = await realpath(sourceWorkspacePath)
          } catch {
            skipped += 1
            continue
          }
          if (!isInside(realRoot, realSource)) {
            skipped += 1
            continue
          }
          files.push({ rel, size: info.size })
        }
      }
      entries.push({ sessionId, title, sourceWorkspacePath, folder, files, skipped, writtenError })
    }
    const lines = [`删除预览：共 ${ids.length} 个会话`]
    for (const entry of entries) {
      lines.push(`- ${entry.title}（${entry.sourceWorkspacePath}）`)
      lines.push(`  会话目录：${entry.folder !== undefined ? entry.folder : '未找到带 .dsh-session 标记的目录（不会自动删除未标记目录）'}`)
      if (!deleteWrittenFiles) {
        lines.push('  外部文件：不删除（未勾选）')
      } else if (entry.writtenError !== undefined) {
        lines.push(`  外部文件：读取记录失败（${entry.writtenError instanceof Error ? entry.writtenError.message : String(entry.writtenError)}）`)
      } else {
        lines.push(`  外部文件：${entry.files.length} 个${entry.skipped > 0 ? `，跳过 ${entry.skipped} 个` : ''}`)
        for (const file of entry.files.slice(0, 20)) {
          lines.push(`    - ${file.rel}（${file.size} 字节）`)
        }
        if (entry.files.length > 20) lines.push(`    … 另有 ${entry.files.length - 20} 个`)
      }
    }
    const confirmation = issueConfirmation('session-delete', {
      sessionIds: [...ids].sort(),
      deleteWrittenFiles,
    })
    return JSON.stringify({ ok: true, summary: lines.join('\n'), confirmation })
  }

  /**
   * Delete several inactive sessions, one by one.
   * @param input command payload.
   * @param carrierSessionId session running this command.
   * @returns a per-session summary.
   */
  async function runSessionDeleteBatch (input, carrierSessionId, signal) {
    const ids = [...new Set((Array.isArray(input.sessionIds) ? input.sessionIds : [])
      .filter((id) => typeof id === 'string' && id !== ''))]
    if (ids.length === 0) throw new Error('请至少选择一个会话')
    if (ids.length > 100) throw new Error('一次最多删除 100 个会话；请分批操作')
    const deleteWrittenFiles = input.deleteWrittenFiles === true
    const titles = input.sessionTitles !== null && typeof input.sessionTitles === 'object' && !Array.isArray(input.sessionTitles)
      ? input.sessionTitles
      : {}
    const successes = []
    const failures = []
    for (const sessionId of ids) {
      signal?.throwIfAborted()
      const title = typeof titles[sessionId] === 'string' && titles[sessionId].trim() !== ''
        ? titles[sessionId].trim()
        : sessionId
      try {
        await runSessionDelete({ sessionId, sessionTitle: title, deleteWrittenFiles }, carrierSessionId)
        successes.push({ sessionId, title })
      } catch (error) {
        failures.push({
          sessionId,
          title,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const lines = [`批量删除会话：共 ${ids.length} 个，成功 ${successes.length} 个，失败 ${failures.length} 个。`]
    if (successes.length > 0) {
      lines.push('成功：')
      for (const success of successes) lines.push(`- ${success.title}`)
    }
    if (failures.length > 0) {
      lines.push('失败：')
      for (const failure of failures) lines.push(`- ${failure.title}：${failure.message}`)
    }
    if (successes.length > 0) lines.push('请重启 DSH 刷新会话列表和缓存。')
    return lines.join('\n')
  }

  /**
   * Create the standard sessions structure and optionally move loose root files.
   * @param input command payload.
   * @returns a human-readable result.
   */
  async function runOrganize (input) {
    const registry = ctx.workspaceRegistry
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
    if (workspaceId === '') throw new Error('缺少 workspaceId')
    const workspace = registry.get(workspaceId)
    if (workspace === undefined) throw new Error('工作区不存在，可能已在侧边栏删除')
    if (!(await isDirectory(workspace.path))) throw new Error(`工作区目录不存在：${workspace.path}`)
    const sessionsDir = join(workspace.path, config.sessionsDirName)
    try {
      await mkdir(sessionsDir, { recursive: true })
    } catch (error) {
      throw new Error(`无法创建 sessions 目录：${sessionsDir}（${error instanceof Error ? error.message : String(error)}）`)
    }
    const readmeCreated = await ensureFile(join(sessionsDir, 'README.md'), SESSIONS_README)
    const loose = await listLooseRootFiles(workspace.path, config.sessionsDirName, ROOT_FILE_ALLOWLIST)
    const lines = [
      `工作区：${workspace.path}`,
      `sessions 目录：${sessionsDir}`,
      `说明文件：${readmeCreated ? '已创建' : '已存在'}`,
    ]
    if (loose.length === 0) {
      lines.push('根目录没有可整理的散件文件。')
    } else if (input.moveLooseFiles === true) {
      const destination = await createUniqueDirectory(sessionsDir, `${formatDatePrefix(Date.now())}_整理`)
      const moved = []
      const failed = []
      for (const name of loose) {
        try {
          await rename(join(workspace.path, name), join(destination, name))
          moved.push(name)
        } catch (error) {
          failed.push(`${name}（${error instanceof Error ? error.message : String(error)}）`)
        }
      }
      if (moved.length === 0) {
        await rm(destination, { recursive: true, force: true }).catch(() => {})
        lines.push(`根目录散件 ${loose.length} 个，但全部移动失败。`)
      } else {
        lines.push(`已移动 ${moved.length} 个散件到：${destination}`)
      }
      if (failed.length > 0) lines.push(`未能移动：${failed.join('；')}`)
    } else {
      lines.push(`根目录散件 ${loose.length} 个：${loose.join('、')}`)
      lines.push('未移动散件；勾选“移动散件”后会移入 sessions/<日期>_整理/。')
    }
    return lines.join('\n')
  }

  /**
   * Read the sessions that would block a relocation, without changing anything.
   * The client uses this to ask the user before force-stopping them.
   * @param input command payload carrying the workspaceId.
   * @returns JSON text with the blocking session list.
   */
  async function runCheck (input) {
    const registry = ctx.workspaceRegistry
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
    if (workspaceId === '') throw new Error('缺少 workspaceId')
    const workspace = registry.get(workspaceId)
    if (workspace === undefined) throw new Error('工作区不存在，可能已在侧边栏删除')
    const force = input.forceCloseBlockers === true
    const blockers = blockingAgentsOf(workspace.path).map((agent) => {
      const title = agent?.session?.title ?? agent?.session?.header?.title
      return {
        id: agent.id,
        title: typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined,
        cwd: agent.session?.header?.cwd,
      }
    })
    const confirmation = issueConfirmation('workspace-relocate', { workspaceId, forceCloseBlockers: force })
    return JSON.stringify({ ok: true, blockers, confirmation })
  }

  ctx.effect(() => ctx.commands.register({
    name: 'workspace-relocate-check',
    description: '检查移动工作区是否被运行中的会话阻塞（“工作区”设置页使用）',
    input: { hint: '{"workspaceId":"…","forceCloseBlockers":false}' },
    handler: async ({ rawInput, signal }) => {
      try {
        signal?.throwIfAborted()
        const text = await runCheck(parseJsonInput(rawInput))
        return { kind: 'success', text }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'workspace-relocate-strict',
    description: '严格移动工作区文件夹并改写会话日志（“工作区”设置页使用）',
    input: { hint: '{"workspaceId":"…","targetParent":"…","name":"…","forceCloseBlockers":false,"confirmation":"…"}' },
    handler: async ({ rawInput, signal }) => {
      try {
        signal?.throwIfAborted()
        const input = parseJsonInput(rawInput)
        const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
        const force = input.forceCloseBlockers === true
        requireConfirmation('workspace-relocate', input.confirmation, { workspaceId, forceCloseBlockers: force })
        const text = await withOperationLock(() => runRelocate(input))
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 移动工作区失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'workspace-organize',
    description: '创建 sessions/ 标准结构，可选整理根目录散件',
    input: { hint: '{"workspaceId":"…","moveLooseFiles":false}' },
    handler: async ({ rawInput, signal }) => {
      try {
        signal?.throwIfAborted()
        const text = await runOrganize(parseJsonInput(rawInput))
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 整理工作区失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'session-relocate',
    description: '把未运行的会话移动到另一个工作区（“工作区”设置页使用）',
    input: { hint: '{"sessionId":"…","targetWorkspaceId":"…"}' },
    handler: async ({ rawInput, signal, agent }) => {
      try {
        signal?.throwIfAborted()
        const text = await withOperationLock(() => runSessionRelocate(parseJsonInput(rawInput), agent?.id))
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 移动会话失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'session-relocate-batch',
    description: '批量把未运行的会话移动到同一个工作区（“工作区”设置页使用）',
    input: { hint: '{"sessionIds":["…"],"targetWorkspaceId":"…"}' },
    handler: async ({ rawInput, signal, agent }) => {
      try {
        signal?.throwIfAborted()
        const text = await withOperationLock(() => runSessionRelocateBatch(parseJsonInput(rawInput), agent?.id, signal))
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 批量移动会话失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'session-delete-preview',
    description: '预览删除会话会删除的日志、会话目录和外部文件（“工作区”设置页使用）',
    input: { hint: '{"sessionIds":["…"],"deleteWrittenFiles":false}' },
    handler: async ({ rawInput, signal, agent }) => {
      try {
        signal?.throwIfAborted()
        const text = await runSessionDeletePreview(parseJsonInput(rawInput), agent?.id)
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 预览删除会话失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'session-delete',
    description: '永久删除未运行的会话及其 sessions/ 目录和文件（“工作区”设置页使用）',
    input: { hint: '{"sessionId":"…","deleteWrittenFiles":false,"confirmation":"…"}' },
    handler: async ({ rawInput, signal, agent }) => {
      try {
        signal?.throwIfAborted()
        const input = parseJsonInput(rawInput)
        requireConfirmation('session-delete', input.confirmation, {
          sessionIds: [typeof input.sessionId === 'string' ? input.sessionId : ''].filter(Boolean).sort(),
          deleteWrittenFiles: input.deleteWrittenFiles === true,
        })
        const text = await withOperationLock(() => runSessionDelete(input, agent?.id))
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 删除会话失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'session-delete-batch',
    description: '批量永久删除未运行的会话及其 sessions/ 目录和文件（“工作区”设置页使用）',
    input: { hint: '{"sessionIds":["…"],"deleteWrittenFiles":false,"confirmation":"…"}' },
    handler: async ({ rawInput, signal, agent }) => {
      try {
        signal?.throwIfAborted()
        const input = parseJsonInput(rawInput)
        const ids = [...new Set((Array.isArray(input.sessionIds) ? input.sessionIds : [])
          .filter((id) => typeof id === 'string' && id !== ''))].sort()
        requireConfirmation('session-delete', input.confirmation, {
          sessionIds: ids,
          deleteWrittenFiles: input.deleteWrittenFiles === true,
        })
        const text = await withOperationLock(() => runSessionDeleteBatch(input, agent?.id, signal))
        return { kind: 'success', text }
      } catch (error) {
        ctx.logger.warn('workspace-organizer: 批量删除会话失败', error)
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  }))

  void processPendingAttach().then((unresolved) => {
    if (unresolved > 0) schedulePendingAttach(0)
  }).catch((error) => {
    ctx.logger.warn('workspace-organizer: 处理待归属会话失败', error)
    schedulePendingAttach(0)
  })

  for (const agent of ctx.agents.list()) {
    void ensureSessionFolder(agent).catch((error) => {
      ctx.logger.warn('workspace-organizer: 补建会话目录失败', error)
    })
  }
}
