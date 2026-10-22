import { constants } from 'node:zlib'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { cp, mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { samePath } from './fs-ops.js'

const ZSTD_MAGIC = 0xfd2fb528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/
const MAX_LOG_BYTES = 256 * 1024 * 1024
const MAX_SCAN_LOG_BYTES = 64 * 1024 * 1024
const MAX_FRAME_OUTPUT = 32 * 1024 * 1024
const MAX_EVENTS = 200000

/** Escape one session id into a safe path segment, exactly like the JSONL backend. @param raw session id. @returns encoded segment. */
export function encodeSegment (raw) {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Readable project directory key, exactly like the JSONL backend.
 * @param cwd absolute project path.
 * @returns the one-segment directory name.
 */
export function sessionProjectKey (cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * Length of the first complete Zstandard frame in a buffer.
 * @param buffer bytes beginning at a frame.
 * @returns byte length of that frame.
 */
export function firstZstdFrameLength (buffer) {
  if (buffer.length < 5) throw new Error('truncated Zstandard frame')
  if (buffer.readUInt32LE(0) !== ZSTD_MAGIC) throw new Error('not a Zstandard frame')
  const descriptor = buffer[4]
  const fcsFlag = descriptor >>> 6
  const singleSegment = (descriptor >>> 5) & 1
  const hasChecksum = (descriptor >>> 2) & 1
  const dictionaryFlag = descriptor & 3
  let position = 5
  if (singleSegment === 0) position += 1
  if (dictionaryFlag === 1) position += 1
  else if (dictionaryFlag === 2) position += 2
  else if (dictionaryFlag === 3) position += 4
  if (fcsFlag === 0) {
    if (singleSegment === 1) position += 1
  } else if (fcsFlag === 1) position += 2
  else if (fcsFlag === 2) position += 4
  else position += 8
  while (true) {
    if (position + 3 > buffer.length) throw new Error('truncated Zstandard block header')
    const header = buffer[position] | (buffer[position + 1] << 8) | (buffer[position + 2] << 16)
    const last = header & 1
    const type = (header >>> 1) & 3
    const size = header >>> 3
    position += 3
    if (type === 0) position += size
    else if (type === 1) position += 1
    else if (type === 2) position += size
    else throw new Error('reserved Zstandard block type')
    if (last === 1) break
  }
  if (hasChecksum === 1) position += 4
  if (position > buffer.length) throw new Error('truncated Zstandard frame')
  return position
}

/**
 * Pick the highest canonical generation log in one session directory.
 * @param sessionDir session-owned directory.
 * @returns absolute log path, or undefined.
 */
export async function findCurrentLogFile (sessionDir) {
  let entries
  try {
    entries = await readdir(sessionDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
    throw error
  }
  let best
  let bestVersion = -1
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = LOG_NAME.exec(entry.name)
    if (match === null) continue
    const version = match[1] === undefined ? 0 : Number(match[1])
    if (version > bestVersion) {
      bestVersion = version
      best = join(sessionDir, entry.name)
    }
  }
  return best
}

/**
 * Read the first header frame of a session log without reading event frames.
 * @param file log path.
 * @returns the parsed header.
 */
export async function readLogHeader (file) {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (info.size > MAX_LOG_BYTES) {
      throw new Error(`会话日志过大（${info.size} 字节），超过 ${MAX_LOG_BYTES} 字节上限，已拒绝自动处理。`)
    }
    const chunkSize = Math.min(info.size, 256 * 1024)
    const chunk = Buffer.alloc(chunkSize)
    await handle.read(chunk, 0, chunkSize, 0)
    if (file.endsWith('.zstd')) {
      const length = firstZstdFrameLength(chunk)
      const frame = chunk.subarray(0, length)
      const text = zstdDecompressSync(frame, { maxOutputLength: MAX_FRAME_OUTPUT }).toString('utf8')
      if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
        throw new Error('session log header frame does not contain exactly one line')
      }
      const header = JSON.parse(text.slice(0, -1))
      if (header === null || typeof header !== 'object' || header.type !== 'session') {
        throw new Error('session log first frame is not a session header')
      }
      return { header, frameLength: length, compressed: true }
    }
    const text = chunk.toString('utf8')
    const end = text.indexOf('\n')
    if (end < 0) throw new Error('session log has no complete header line')
    const header = JSON.parse(text.slice(0, end))
    if (header === null || typeof header !== 'object' || header.type !== 'session') {
      throw new Error('session log first line is not a session header')
    }
    return { header, frameLength: end + 1, compressed: false }
  } finally {
    await handle.close()
  }
}

/**
 * Rewrite one session log's header cwd without touching event frames.
 * @param file log path.
 * @param newCwd replacement cwd.
 * @returns a rollback token.
 */
export async function rewriteLogCwd (file, newCwd) {
  const info = await stat(file)
  if (info.size > MAX_LOG_BYTES) {
    throw new Error(`会话日志过大（${info.size} 字节），超过 ${MAX_LOG_BYTES} 字节上限，已拒绝改写。`)
  }
  const bytes = await readFile(file)
  if (file.endsWith('.zstd')) {
    const length = firstZstdFrameLength(bytes)
    const originalFrame = bytes.subarray(0, length)
    const text = zstdDecompressSync(originalFrame, { maxOutputLength: MAX_FRAME_OUTPUT }).toString('utf8')
    if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
      throw new Error('session log header frame does not contain exactly one line')
    }
    const header = JSON.parse(text.slice(0, -1))
    if (header === null || typeof header !== 'object' || header.type !== 'session') {
      throw new Error('session log first frame is not a session header')
    }
    header.cwd = newCwd
    const newFrame = zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n', 'utf8'), CHECKSUM_OPTIONS)
    const rest = bytes.subarray(length)
    await writeAtomic(file, Buffer.concat([newFrame, rest]))
    return {
      kind: 'zstd',
      file,
      originalFrame,
      newFrameLength: newFrame.length,
      header,
    }
  }
  const text = bytes.toString('utf8')
  const end = text.indexOf('\n')
  if (end < 0) throw new Error('session log has no complete header line')
  const header = JSON.parse(text.slice(0, end))
  if (header === null || typeof header !== 'object' || header.type !== 'session') {
    throw new Error('session log first line is not a session header')
  }
  header.cwd = newCwd
  const line = JSON.stringify(header) + '\n'
  await writeAtomic(file, Buffer.from(line + text.slice(end + 1), 'utf8'))
  return {
    kind: 'plain',
    file,
    originalLine: text.slice(0, end + 1),
    newLineLength: Buffer.byteLength(line, 'utf8'),
    header,
  }
}

/**
 * Undo one header rewrite.
 * @param token value returned by rewriteLogCwd.
 */
export async function restoreLogHeader (token) {
  const bytes = await readFile(token.file)
  if (token.kind === 'zstd') {
    const rest = bytes.subarray(token.newFrameLength)
    await writeAtomic(token.file, Buffer.concat([token.originalFrame, rest]))
    return
  }
  const text = bytes.toString('utf8')
  const rest = text.slice(token.newLineLength)
  await writeAtomic(token.file, Buffer.from(token.originalLine + rest, 'utf8'))
}

/**
 * Inventory one project directory's session logs.
 * @param projectDir the `--<cwd>--` directory.
 * @param oldCwd only sessions whose header cwd equals this path are returned.
 * @returns matching session log records.
 */
export async function scanProjectSessions (projectDir, oldCwd) {
  let entries
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
    throw error
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(projectDir, entry.name)
    const file = await findCurrentLogFile(dir)
    if (file === undefined) continue
    let parsed
    try {
      parsed = await readLogHeader(file)
    } catch (error) {
      throw new Error(`无法读取会话日志头：${file}（${error instanceof Error ? error.message : String(error)}）`)
    }
    if (typeof parsed.header.cwd !== 'string' || !samePath(parsed.header.cwd, oldCwd)) continue
    found.push({
      id: parsed.header.id,
      dir,
      file,
      header: parsed.header,
      encoded: entry.name,
    })
  }
  return found
}

/**
 * Atomically replace one file inside its directory.
 * @param file destination.
 * @param data complete new bytes.
 */
export async function writeAtomic (file, data) {
  const temp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${Date.now()}`)
  await writeFile(temp, data)
  await rename(temp, file)
}

/**
 * Move a session-owned log directory into another project directory.
 * @param source current session directory.
 * @param destinationProject new `--<cwd>--` directory.
 * @returns destination path.
 */
export async function moveSessionDir (source, destinationProject) {
  await mkdir(destinationProject, { recursive: true })
  const destination = join(destinationProject, basename(source))
  await rename(source, destination)
  return destination
}

/**
 * Copy a session log directory into another project directory without detaching
 * the source. Used for sessions the user chose to force-stop: their agent still
 * holds the log file open, so Windows refuses a rename and the source stays.
 * @param source current session directory.
 * @param destinationProject new `--<cwd>--` directory.
 * @returns destination path.
 */
export async function copySessionDir (source, destinationProject) {
  await mkdir(destinationProject, { recursive: true })
  const destination = join(destinationProject, basename(source))
  await cp(source, destination, { recursive: true, force: false })
  return destination
}

const WRITE_TOOL_NAMES = new Set([
  'write', 'edit', 'multi_edit', 'write_file', 'edit_file', 'create_file',
  'str_replace_editor', 'apply_patch', 'notebook_edit',
])

/**
 * Read every event from one log generation. The file is either plain JSONL or
 * a concatenation of independent Zstandard frames, each containing JSONL lines.
 * @param file log path.
 * @returns parsed event objects.
 */
async function readLogEvents (file) {
  const info = await stat(file)
  if (info.size > MAX_SCAN_LOG_BYTES) {
    throw new Error(`会话日志过大（${info.size} 字节），超过外部文件扫描上限 ${MAX_SCAN_LOG_BYTES} 字节。`)
  }
  const bytes = await readFile(file)
  const events = []
  if (file.endsWith('.zstd')) {
    let offset = 0
    while (offset < bytes.length) {
      const frame = bytes.subarray(offset)
      let length
      try {
        length = firstZstdFrameLength(frame)
      } catch {
        break
      }
      if (length <= 0) break
      const text = zstdDecompressSync(frame.subarray(0, length), { maxOutputLength: MAX_FRAME_OUTPUT }).toString('utf8')
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        let event
        try { event = JSON.parse(line) } catch { continue }
        if (event !== null && typeof event === 'object') {
          events.push(event)
          if (events.length > MAX_EVENTS) throw new Error(`会话日志事件数超过 ${MAX_EVENTS}，已停止扫描。`)
        }
      }
      offset += length
    }
    return events
  }
  const text = bytes.toString('utf8')
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event !== null && typeof event === 'object') {
      events.push(event)
      if (events.length > MAX_EVENTS) throw new Error(`会话日志事件数超过 ${MAX_EVENTS}，已停止扫描。`)
    }
  }
  return events
}

/**
 * Collect the file paths a session wrote through write/edit-style tools.
 * Only tool calls recorded in the session's own log generations are used;
 * shell commands that create files internally are not represented here.
 * @param sessionDir session-owned log directory.
 * @returns absolute or workspace-relative paths, in first-seen order.
 */
export async function collectSessionWrittenPaths (sessionDir) {
  let entries
  try {
    entries = await readdir(sessionDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
    throw error
  }
  const files = entries
    .filter((entry) => entry.isFile() && LOG_NAME.test(entry.name))
    .map((entry) => join(sessionDir, entry.name))
    .sort()
  const seen = new Set()
  const paths = []
  for (const file of files) {
    const events = await readLogEvents(file)
    for (const event of events) {
      if (event.type !== 'tool/call') continue
      const data = event.data
      if (data === null || typeof data !== 'object') continue
      const name = typeof data.name === 'string' ? data.name : ''
      if (!WRITE_TOOL_NAMES.has(name.toLowerCase())) continue
      let args = data.arguments
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { continue }
      }
      if (args === null || typeof args !== 'object') continue
      const raw = args.file_path ?? args.path ?? args.target ?? args.filename
      if (typeof raw !== 'string' || raw.trim() === '') continue
      const value = raw.trim()
      if (seen.has(value)) continue
      seen.add(value)
      paths.push(value)
    }
  }
  return paths
}
