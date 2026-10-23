import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants, zstdCompressSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectSessionWrittenPaths,
  encodeSegment,
  readLogHeader,
  restoreLogHeader,
  rewriteLogCwd,
  sessionProjectKey,
} from '../lib/session-logs.js'

const ZSTD = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

test('session path encoders keep canonical separators and ids', () => {
  assert.equal(encodeSegment('session-1'), 'session-1')
  assert.match(encodeSegment('a/b'), /^a~002Fb$/)
  assert.match(sessionProjectKey('D:\\demo\\ws'), /^--D-demo-ws--$/)
})

test('log header rewrite is reversible and keeps event frames byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wso-log-'))
  try {
    const sessionDir = join(root, 'session-s1')
    await mkdir(sessionDir, { recursive: true })
    const file = join(sessionDir, 'session.jsonl.zstd')
    const header = {
      type: 'session',
      version: 4,
      id: 'session-s1',
      createdAt: Date.now(),
      cwd: 'D:\\old',
      isSeeded: false,
      delegationDepth: 0,
    }
    const event = {
      type: 'tool/call',
      seq: 1,
      time: Date.now(),
      data: { name: 'write', arguments: JSON.stringify({ file_path: 'D:\\old\\a.txt', content: 'alpha' }) },
    }
    const headerFrame = zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n'), ZSTD)
    const eventFrame = zstdCompressSync(Buffer.from(JSON.stringify(event) + '\n'), ZSTD)
    const original = Buffer.concat([headerFrame, eventFrame])
    await writeFile(file, original)

    const beforeHeader = await readLogHeader(file)
    assert.equal(beforeHeader.header.cwd, 'D:\\old')
    const paths = await collectSessionWrittenPaths(sessionDir)
    assert.deepEqual(paths, ['D:\\old\\a.txt'])

    const token = await rewriteLogCwd(file, 'D:\\new')
    const rewritten = await readFile(file)
    assert.deepEqual(rewritten.subarray(token.newFrameLength), original.subarray(headerFrame.length))
    const afterHeader = await readLogHeader(file)
    assert.equal(afterHeader.header.cwd, 'D:\\new')

    await restoreLogHeader(token)
    assert.deepEqual(await readFile(file), original)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
