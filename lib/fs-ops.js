import { createReadStream } from 'node:fs'
import {
  cp, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, rmdir,
  stat, symlink, unlink, writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const IS_WINDOWS = process.platform === 'win32'
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
export const SESSION_MARKER = '.dsh-session'

/** Whether a path is fully qualified on this host. @param path candidate. @returns true for an absolute path. */
export function isAbsolutePath (path) {
  return typeof path === 'string' && isAbsolute(path)
}

/** Normalize separators and drop a trailing separator (except a drive root). @param path candidate. @returns comparable path text. */
export function normalizePath (path) {
  const text = String(path).replace(/[\\/]+/g, IS_WINDOWS ? '\\' : '/')
  if (/^[a-zA-Z]:\\$/.test(text) || text === '/' || text === '\\') return text
  return text.replace(/[\\/]$/, '')
}

/** Compare two paths with Windows case folding. @param a first path. @param b second path. @returns equality. */
export function samePath (a, b) {
  const left = normalizePath(a)
  const right = normalizePath(b)
  return IS_WINDOWS ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * Whether `child` is strictly below `parent`.
 * @param parent container path.
 * @param child candidate path.
 * @returns true when child is nested under parent.
 */
export function isInside (parent, child) {
  const rel = relative(normalizePath(parent), normalizePath(child))
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)
}

/** @param parent container path. @param child candidate path. @returns true when equal or nested. */
export function isSameOrInside (parent, child) {
  return samePath(parent, child) || isInside(parent, child)
}

/** @param a path. @param b path. @returns true when both live on the same volume root. */
export function sameRoot (a, b) {
  const left = parse(normalizePath(a)).root
  const right = parse(normalizePath(b)).root
  return IS_WINDOWS ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * Turn arbitrary title text into one safe Windows folder segment.
 * @param name source text.
 * @param maxLength code-point cap.
 * @returns a non-empty safe segment.
 */
export function sanitizeFolderName (name, maxLength = 40) {
  let text = String(name ?? '').normalize('NFC')
  text = text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
  text = text.replace(/\s+/g, '_')
  text = text.replace(/^[._\s]+|[._\s]+$/g, '')
  const chars = Array.from(text)
  if (chars.length > maxLength) text = chars.slice(0, maxLength).join('')
  text = text.replace(/[.\s]+$/g, '')
  if (text === '') text = '会话'
  if (RESERVED.test(text)) text = '_' + text
  return text
}

/**
 * Validate a user-supplied target folder leaf name.
 * @param name proposed folder name.
 * @returns a Chinese error message, or undefined when valid.
 */
export function validateLeafName (name) {
  if (typeof name !== 'string') return '文件夹名必须是字符串'
  if (name.trim() === '') return '文件夹名不能为空'
  if (name !== name.trim()) return '文件夹名不能以空格开头或结尾'
  if (name === '.' || name === '..') return '文件夹名不能是 . 或 ..'
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return '文件夹名包含非法字符（<>:"/\\|?*）'
  if (/[. ]$/.test(name)) return '文件夹名不能以点或空格结尾'
  if (RESERVED.test(name)) return '文件夹名是 Windows 保留名（如 CON、NUL）'
  return undefined
}

/** @param createdAt epoch milliseconds. @returns local YYYY-MM-DD. */
export function formatDatePrefix (createdAt) {
  const date = new Date(createdAt)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** @param path candidate. @returns whether any directory entry exists there. */
export async function pathExists (path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

/**
 * Create one uniquely named directory under a parent.
 * @param parent existing parent directory.
 * @param base preferred leaf name.
 * @returns the created absolute directory path.
 */
export async function createUniqueDirectory (parent, base) {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`
    try {
      const target = join(parent, candidate)
      await mkdir(target)
      return target
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  throw new Error(`无法在“${parent}”下生成不冲突的目录名：${base}`)
}

/**
 * Resolve a free leaf name without creating it.
 * @param parent existing parent directory.
 * @param base preferred leaf name.
 * @returns a leaf name that does not exist yet.
 */
export async function uniqueChildName (parent, base) {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`
    if (!(await pathExists(join(parent, candidate)))) return candidate
  }
  throw new Error(`无法在“${parent}”下生成不冲突的名称：${base}`)
}

/**
 * Recursively inventory a tree without following links.
 * @param root directory to walk.
 * @param options.hash add SHA-256 for files up to the hash limit.
 * @returns entries with relative POSIX-style paths.
 */
export async function listTree (root, options = {}) {
  const entries = []
  async function walk (directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const absolute = join(directory, child.name)
      const rel = prefix === '' ? child.name : `${prefix}/${child.name}`
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) {
        entries.push({ rel, type: 'link', link: await readlink(absolute) })
        continue
      }
      if (info.isDirectory()) {
        const canonical = await realpath(absolute)
        if (!samePath(canonical, absolute)) {
          entries.push({ rel, type: 'link', link: canonical })
          continue
        }
        entries.push({ rel, type: 'dir' })
        await walk(absolute, rel)
        continue
      }
      if (info.isFile()) {
        const entry = { rel, type: 'file', size: info.size }
        if (options.hash === true && info.size <= 256 * 1024) {
          entry.hash = createHash('sha256').update(await readFile(absolute)).digest('hex')
        }
        entries.push(entry)
        continue
      }
      entries.push({ rel, type: 'other' })
    }
  }
  await walk(root, '')
  return entries
}

/**
 * Copy a directory tree and verify every relative entry, file size and small
 * file hash. Links are rejected because automatic relocation cannot preserve
 * them safely here.
 * @param source existing directory.
 * @param destination absent directory.
 */
export async function copyTreeVerified (source, destination) {
  const before = await listTree(source, { hash: true })
  if (before.some((entry) => entry.type === 'link' || entry.type === 'other')) {
    throw new Error('工作区里包含符号链接或联接点，暂不支持自动复制迁移；请手动处理后再试。')
  }
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
  const after = await listTree(destination, { hash: true })
  const expected = new Map(before.map((entry) => [entry.rel, entry]))
  let valid = after.length === before.length
  if (valid) {
    for (const entry of after) {
      const original = expected.get(entry.rel)
      if (original === undefined || original.type !== entry.type) { valid = false; break }
      if (entry.type === 'file') {
        if (original.size !== entry.size) { valid = false; break }
        if (original.hash !== undefined || entry.hash !== undefined) {
          if (original.hash === undefined || entry.hash === undefined || original.hash !== entry.hash) {
            valid = false
            break
          }
        }
      }
    }
  }
  if (!valid) {
    await rm(destination, { recursive: true, force: true }).catch(() => {})
    throw new Error('复制后的校验失败，已删除不完整的副本；原目录保持不变。')
  }
}

async function hashFileStream (file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function filesEqual (left, right) {
  const [leftInfo, rightInfo] = await Promise.all([stat(left), stat(right)])
  if (!leftInfo.isFile() || !rightInfo.isFile() || leftInfo.size !== rightInfo.size) return false
  return (await hashFileStream(left)) === (await hashFileStream(right))
}

async function uniqueFileName (directory, name, tag) {
  const ext = extname(name)
  const base = ext === '' ? name : name.slice(0, -ext.length)
  let candidate = `${base}.${tag}${ext}`
  let index = 2
  while (true) {
    try {
      await lstat(join(directory, candidate))
      candidate = `${base}.${tag}-${index}${ext}`
      index += 1
    } catch (error) {
      if (error.code === 'ENOENT') return candidate
      throw error
    }
  }
}

/**
 * Merge a legacy directory into an existing target without overwriting files.
 * Identical files are skipped; conflicting files keep the target and receive a
 * source-tagged copy. The source is removed only after every copied file has
 * been hash-verified.
 * @param source legacy directory.
 * @param destination existing target directory.
 * @param tag source tag used in conflict file names.
 * @param options.skip relative paths to leave alone (for example .dsh-session).
 * @returns per-entry actions.
 */
export async function mergeTreeVerified (source, destination, tag, options = {}) {
  const sourceTree = await listTree(source)
  const skip = new Set(Array.isArray(options.skip) ? options.skip : [])
  const actions = []
  for (const entry of sourceTree) {
    if (skip.has(entry.rel)) continue
    const relPath = entry.rel.split('/').join(sep)
    const sourcePath = join(source, relPath)
    if (entry.type === 'dir') {
      await mkdir(join(destination, relPath), { recursive: true })
      continue
    }
    if (entry.type !== 'file') throw new Error(`旧目录包含不支持的文件类型：${entry.rel}`)
    const targetDirectory = join(destination, dirname(relPath))
    let targetName = basename(relPath)
    let targetPath = join(targetDirectory, targetName)
    let action = 'copied'
    let exists = true
    try { await lstat(targetPath) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      exists = false
    }
    if (exists) {
      if (await filesEqual(sourcePath, targetPath)) {
        actions.push({ rel: entry.rel, action: 'identical-skip' })
        continue
      }
      targetName = await uniqueFileName(targetDirectory, targetName, tag)
      targetPath = join(targetDirectory, targetName)
      action = 'renamed-conflict'
    }
    await mkdir(targetDirectory, { recursive: true })
    await cp(sourcePath, targetPath, { force: false, errorOnExist: true, preserveTimestamps: true })
    if (!(await filesEqual(sourcePath, targetPath))) {
      throw new Error(`合并后的校验失败：${entry.rel}`)
    }
    actions.push({ rel: entry.rel, action, targetName: action === 'renamed-conflict' ? targetName : undefined })
  }
  await rm(source, { recursive: true, force: true })
  return actions
}

/** Windows errors that mean another process holds the directory open. */
export const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

/**
 * Whether a filesystem error is a sharing violation rather than a real failure.
 * @param error thrown error.
 * @returns true when the error code means the source is locked.
 */
export function isBusyError (error) {
  return error !== null && typeof error === 'object' && BUSY_CODES.has(error.code)
}

/**
 * Copy a directory without detaching the source. Used when the old path is held
 * open by a running DSH process, where Windows refuses to rename it. The caller
 * keeps the original directory and asks the user to delete it after a restart.
 * @param oldPath existing directory.
 * @param newPath absent destination.
 * @returns relocation descriptor understood by rollbackRelocate.
 */
export async function copyDirectoryKeepingSource (oldPath, newPath) {
  try {
    await copyTreeVerified(oldPath, newPath)
  } catch (error) {
    await rm(newPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return { mode: 'copy-keep', backup: undefined }
}

/**
 * Move a directory, using rename on one volume and copy+verify on another.
 * For the copy path the source is first renamed to a reversible backup so a later
 * failure never destroys the only copy.
 * @param oldPath existing directory.
 * @param newPath absent destination.
 * @param options.beforeDetach optional hook called immediately before the source is detached.
 * @returns how the move was performed and the backup path when one exists.
 */
export async function relocateDirectory (oldPath, newPath, options = {}) {
  try {
    if (options.beforeDetach !== undefined) await options.beforeDetach()
    await rename(oldPath, newPath)
    return { mode: 'rename', backup: undefined }
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
  }
  await copyTreeVerified(oldPath, newPath)
  const backup = join(
    dirname(oldPath),
    `.${basename(oldPath)}.dsh-move-backup-${Date.now()}`,
  )
  try {
    if (options.beforeDetach !== undefined) await options.beforeDetach()
    await rename(oldPath, backup)
  } catch (error) {
    await rm(newPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return { mode: 'copy', backup }
}

/**
 * Undo a completed directory relocation.
 * @param relocation result from relocateDirectory.
 * @param oldPath original directory path.
 * @param newPath destination path.
 */
export async function rollbackRelocate (relocation, oldPath, newPath) {
  if (relocation.mode === 'rename') {
    if (await pathExists(newPath)) await rename(newPath, oldPath)
    return
  }
  if (relocation.backup !== undefined && await pathExists(relocation.backup)) {
    if (await pathExists(oldPath)) {
      const info = await lstat(oldPath)
      if (info.isDirectory()) await rm(oldPath, { recursive: true, force: true })
      else await removeLink(oldPath)
    }
    await rename(relocation.backup, oldPath)
  }
  await rm(newPath, { recursive: true, force: true }).catch(() => {})
}

/**
 * Create a directory junction on Windows or a directory symlink elsewhere.
 * @param target canonical directory the link points at.
 * @param link path to create.
 */
export async function createDirectoryLink (target, link) {
  if (IS_WINDOWS) await symlink(target, link, 'junction')
  else await symlink(target, link, 'dir')
}

/**
 * Remove a directory junction/symlink without touching its target.
 * @param link path to remove.
 */
export async function removeLink (link) {
  try {
    if (IS_WINDOWS) await rmdir(link)
    else await unlink(link)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/**
 * Read a session folder's identity marker.
 * @param folder session folder.
 * @returns the marker record, or undefined.
 */
export async function readSessionMarker (folder) {
  try {
    return JSON.parse(await readFile(join(folder, SESSION_MARKER), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Write a session folder's identity marker.
 * @param folder session folder.
 * @param data marker record.
 */
export async function writeSessionMarker (folder, data) {
  await writeFile(join(folder, SESSION_MARKER), JSON.stringify(data, null, 2), 'utf8')
}

/**
 * Find the existing folder that belongs to one session.
 * @param sessionsDir workspace sessions root.
 * @param sessionId session id.
 * @returns the folder path, or undefined.
 */
export async function findSessionFolder (sessionsDir, sessionId) {
  let entries
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folder = join(sessionsDir, entry.name)
    const marker = await readSessionMarker(folder)
    if (marker !== undefined && marker.sessionId === sessionId) return folder
  }
  return undefined
}

/**
 * List ordinary files sitting directly at a workspace root.
 * @param root workspace directory.
 * @param sessionsDirName the managed sessions directory name.
 * @param allowlist lower-cased names to leave alone.
 * @returns sorted file names.
 */
export async function listLooseRootFiles (root, sessionsDirName, allowlist) {
  const entries = await readdir(root, { withFileTypes: true })
  const names = []
  for (const entry of entries) {
    if (entry.name === sessionsDirName || entry.name.startsWith('.')) continue
    if (allowlist.has(entry.name.toLowerCase())) continue
    const info = await lstat(join(root, entry.name))
    if (info.isFile()) names.push(entry.name)
  }
  return names.sort((left, right) => left.localeCompare(right))
}

/**
 * Create a file only when it is absent.
 * @param path destination.
 * @param content UTF-8 text.
 * @returns whether this call created the file.
 */
export async function ensureFile (path, content) {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  }
}

/** @param path candidate. @returns whether it is an existing directory. */
export async function isDirectory (path) {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

/** Resolve a maybe-relative path against a base. @param base base directory. @param path candidate. @returns absolute path. */
export function resolvePath (base, path) {
  return isAbsolute(path) ? resolve(path) : resolve(base, path)
}
