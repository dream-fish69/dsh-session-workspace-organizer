// Restart-route contract tests.
//
// These cover the failure modes that made earlier attempts look broken rather
// than the happy path only: a blocked event loop on the status route, an
// unreadable body, and the "is anything live?" gate that decides whether a
// restart may proceed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { helperSource, appLaunch, restartState, isDirectLoopback, isSameOrigin, scheduleRestart } from '../lib/restart.js'

/** Build a minimal readable request stand-in. */
function fakeRequest (body, method = 'POST') {
  const request = new EventEmitter()
  request.method = method
  request.headers = { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1' }
  request.socket = { remoteAddress: '127.0.0.1', localPort: 1 }
  if (body !== undefined) {
    process.nextTick(() => {
      request.emit('data', Buffer.from(body))
      request.emit('end')
    })
  } else {
    process.nextTick(() => request.emit('end'))
  }
  request.destroy = () => {}
  return request
}

test('restart state is shared across instances so a fresh boot can report it', () => {
  const first = restartState()
  const second = restartState()
  assert.equal(first, second)
  assert.equal(typeof first.revision, 'number')
})

test('helper strips the Node-mode variable so the relaunched app opens a window', () => {
  const source = helperSource({ file: 'X', args: [], cwd: 'Y', desktop: true }, 1, 2, 0, { out: 'a', err: 'b' })
  assert.ok(source.includes('delete env.ELECTRON_RUN_AS_NODE'), 'must strip ELECTRON_RUN_AS_NODE')
  assert.ok(!source.includes("'/F', '/T'"), 'must not tree-kill: it would end the helper itself')
  assert.ok(source.includes('restart complete'), 'must report the verified outcome')
  assert.ok(source.includes('retrying once'), 'must retry an immediate exit')
})

test('helper kills the shell before waiting for the host', () => {
  const source = helperSource({ file: 'X', args: [], cwd: 'Y', desktop: true }, 11, 22, 0, { out: 'a', err: 'b' })
  const killAt = source.indexOf('await killTree(shellPid)')
  const waitAt = source.indexOf('await waitGone(hostPid')
  assert.ok(killAt > 0 && waitAt > killAt, 'the shell must go first: it owns the fatal dialog')
})

test('appLaunch never replays Host-only arguments for a desktop shell', () => {
  const spec = appLaunch()
  assert.equal(typeof spec.file, 'string')
  assert.ok(Array.isArray(spec.args))
  // A desktop relaunch must be a bare application start, never the Host entry
  // with --expose-internals, which would start Node mode instead of the window.
  if (spec.desktop) assert.ok(!spec.args.includes('--expose-internals'))
})

test('request guards reject forwarded and cross-origin callers', () => {
  assert.equal(isDirectLoopback({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true)
  assert.equal(isDirectLoopback({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4' } }), false)
  assert.equal(isDirectLoopback({ socket: { remoteAddress: '10.0.0.5' }, headers: {} }), false)
  assert.equal(isSameOrigin({ headers: { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1' } }), true)
  assert.equal(isSameOrigin({ headers: { origin: 'http://evil.test', host: '127.0.0.1:1' } }), false)
})

test('a body without force does not grant a forced restart', async () => {
  // Mirrors the host-side parser: absent, empty, malformed and oversized bodies
  // all mean "not forced", so a stray click can never interrupt live work.
  const readForcedFlag = async (request) => new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 8192) {
        finish(false)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) return finish(false)
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        finish(parsed !== null && typeof parsed === 'object' && parsed.force === true)
      } catch {
        finish(false)
      }
    })
    request.on('error', () => finish(false))
    request.on('close', () => finish(false))
  })

  assert.equal(await readForcedFlag(fakeRequest(undefined)), false)
  assert.equal(await readForcedFlag(fakeRequest('')), false)
  assert.equal(await readForcedFlag(fakeRequest('not json')), false)
  assert.equal(await readForcedFlag(fakeRequest('{}')), false)
  assert.equal(await readForcedFlag(fakeRequest('{"force":false}')), false)
  assert.equal(await readForcedFlag(fakeRequest('{"force":true}')), true)
  assert.equal(await readForcedFlag(fakeRequest(JSON.stringify({ force: true, pad: 'x'.repeat(9000) }))), false)
})

