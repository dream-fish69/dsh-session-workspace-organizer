import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  copyTreeVerified,
  findSessionFolder,
  isInside,
  listTree,
  mergeTreeVerified,
  readSessionMarker,
  relocateDirectory,
  sanitizeFolderName,
  validateLeafName,
  writeSessionMarker,
} from '../lib/fs-ops.js'

test('sanitizeFolderName strips illegal characters and reserved names', () => {
  assert.equal(sanitizeFolderName('a<>:"/\\|?*b'), 'ab')
  assert.equal(sanitizeFolderName('CON'), '_CON')
  assert.equal(sanitizeFolderName('   '), '会话')
  assert.ok(sanitizeFolderName('x'.repeat(100), 10).length <= 10)
})

test('validateLeafName rejects traversal and separators', () => {
  assert.equal(validateLeafName('ok'), undefined)
  assert.notEqual(validateLeafName('..'), undefined)
  assert.notEqual(validateLeafName('a/b'), undefined)
  assert.notEqual(validateLeafName('CON'), undefined)
  assert.notEqual(validateLeafName(' x'), undefined)
})

test('isInside distinguishes children from siblings', () => {
  const root = join(tmpdir(), 'wso-inside-root')
  assert.equal(isInside(root, join(root, 'child')), true)
  assert.equal(isInside(root, join(tmpdir(), 'wso-other')), false)
  assert.equal(isInside(root, root), false)
})

test('session marker round-trips and can be found', async () => {
  const sessions = await mkdtemp(join(tmpdir(), 'wso-sessions-'))
  try {
    const folder = join(sessions, '2026-01-01_demo')
    await mkdir(folder, { recursive: true })
    await writeSessionMarker(folder, { sessionId: 's1', workspacePath: 'D:\\demo' })
    const marker = await readSessionMarker(folder)
    assert.equal(marker.sessionId, 's1')
    assert.equal(await findSessionFolder(sessions, 's1'), folder)
    assert.equal(await findSessionFolder(sessions, 's2'), undefined)
  } finally {
    await rm(sessions, { recursive: true, force: true })
  }
})

test('copyTreeVerified verifies copied files and hashes small files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wso-copy-'))
  try {
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    await mkdir(join(source, 'nested'), { recursive: true })
    await writeFile(join(source, 'a.txt'), 'alpha')
    await writeFile(join(source, 'nested', 'b.txt'), 'beta')
    await copyTreeVerified(source, destination)
    assert.equal(await readFile(join(destination, 'a.txt'), 'utf8'), 'alpha')
    assert.equal(await readFile(join(destination, 'nested', 'b.txt'), 'utf8'), 'beta')
    const tree = await listTree(destination, { hash: true })
    const file = tree.find((entry) => entry.rel === 'a.txt')
    assert.equal(file.type, 'file')
    assert.match(file.hash, /^[0-9a-f]{64}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mergeTreeVerified renames conflicting files and removes the source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wso-merge-'))
  try {
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    await mkdir(source, { recursive: true })
    await mkdir(destination, { recursive: true })
    await writeFile(join(source, 'a.txt'), 'new')
    await writeFile(join(source, 'b.txt'), 'b')
    await writeFile(join(destination, 'a.txt'), 'old')
    const actions = await mergeTreeVerified(source, destination, 'legacy')
    assert.equal(await readFile(join(destination, 'a.txt'), 'utf8'), 'old')
    assert.equal(await readFile(join(destination, 'a.legacy.txt'), 'utf8'), 'new')
    assert.equal(await readFile(join(destination, 'b.txt'), 'utf8'), 'b')
    assert.ok(actions.some((action) => action.action === 'renamed-conflict'))
    await assert.rejects(readFile(join(source, 'a.txt')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('relocateDirectory moves a directory on the same volume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wso-relocate-'))
  try {
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'a.txt'), 'alpha')
    const result = await relocateDirectory(source, destination)
    assert.equal(result.mode, 'rename')
    assert.equal(await readFile(join(destination, 'a.txt'), 'utf8'), 'alpha')
    await assert.rejects(readFile(join(source, 'a.txt')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
