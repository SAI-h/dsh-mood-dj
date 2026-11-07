import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mood-dj-test-'))
process.env.MOOD_DJ_HOME = tempHome
process.env.MOOD_DJ_DISABLE_CDP = '1'

const { apply } = await import('./index.js')

const state = {
  events: [
    {
      type: 'user/message',
      time: Date.now() - 12000,
      data: { content: [{ type: 'text', text: '今天真的有点累，项目一直卡着，感觉自己快撑不住了。' }] },
    },
    {
      type: 'assistant/message',
      time: Date.now() - 9000,
      data: { message: { content: [{ type: 'text', text: '先别急，我们一点点把问题拆开。' }] } },
    },
    {
      type: 'user/message',
      time: Date.now() - 5000,
      data: { content: [{ type: 'text', text: '嗯，听点安静的吧，不想再被催了。' }] },
    },
  ],
}

const session = {
  id: 'session-test',
  header: { id: 'session-test', createdAt: Date.now() - 60000 },
  ownEvents: () => state.events,
}

const sessions = {
  list: () => [session],
  get: (id) => (id === session.id ? session : undefined),
}

const spawns = []
const subprocess = {
  spawn(spec) {
    spawns.push(spec)
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
    }
  },
}

const routes = new Map()
const effects = []
const ctx = {
  get(name) {
    if (name === 'sessions') return sessions
    if (name === 'subprocess') return subprocess
    return undefined
  },
  effect(factory) {
    effects.push(factory())
  },
  on(_event, _handler) {
    return () => {}
  },
  inject(_services, callback) {
    callback({
      webServer: {
        register(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
      effect(factory) {
        effects.push(factory())
      },
    })
  },
}

apply(ctx)
assert.equal(routes.size, 9, 'nine host routes are registered')
assert.ok(effects.every((dispose) => typeof dispose === 'function'), 'route effects are disposable')

function invoke(routePath, body, method = 'POST') {
  const handler = routes.get(routePath)
  assert.ok(handler, `${routePath} is registered`)
  return new Promise((resolve, reject) => {
    const listeners = new Map()
    const req = {
      method,
      on(event, listener) {
        listeners.set(event, listener)
        return req
      },
      destroy() {},
    }
    const res = {
      writeHead(status, headers) {
        res.status = status
        res.headers = headers
      },
      end(payload) {
        try {
          resolve({ status: res.status, headers: res.headers, body: JSON.parse(payload) })
        } catch (error) {
          reject(error)
        }
      },
    }
    handler(req, res)
    queueMicrotask(() => {
      if (method === 'POST' && body !== undefined) {
        listeners.get('data')?.(Buffer.from(JSON.stringify(body)))
      }
      listeners.get('end')?.()
    })
  })
}

const preview = await invoke('/mood-dj/run', { preview: true })
assert.equal(preview.status, 200)
assert.equal(preview.body.ok, true, JSON.stringify(preview.body))
assert.ok(preview.body.data.song.title)
assert.ok(['comfort', 'calm'].includes(preview.body.data.mood.id), `tired conversation chose ${preview.body.data.mood.id}`)
assert.equal(preview.body.data.conversation.userMessages, 2)
assert.equal(spawns.length, 0, 'preview does not spawn a music app')

const played = await invoke('/mood-dj/run', {})
assert.equal(played.body.ok, true, JSON.stringify(played.body))
assert.equal(played.body.data.app.id, 'netease')
assert.ok(spawns.some((spec) => spec.argv.join(' ').includes('orpheus://')), 'NetEase deep-link is launched')
assert.ok(fs.existsSync(path.join(tempHome, 'state.json')), 'listening diary is written')

const liked = await invoke('/mood-dj/feedback', { songId: played.body.data.song.id, verdict: 'like' })
assert.equal(liked.body.ok, true)
assert.equal(liked.body.data.profile.liked, 1)

const stateRead = await invoke('/mood-dj/state', undefined, 'GET')
assert.equal(stateRead.body.ok, true)
assert.equal(stateRead.body.data.history.length, 1)
assert.equal(stateRead.body.data.history[0].verdict, 'like')

// A clearly happy, high-energy conversation should push toward uplift/release.
state.events = [
  {
    type: 'user/message',
    time: Date.now(),
    data: { content: [{ type: 'text', text: '太好了！项目终于上线成功了，大家一起去庆祝一下，哈哈哈哈！' }] },
  },
]
const happy = await invoke('/mood-dj/run', { preview: true })
assert.equal(happy.body.ok, true, JSON.stringify(happy.body))
assert.ok(['uplift', 'warm', 'release'].includes(happy.body.data.mood.id), `happy conversation chose ${happy.body.data.mood.id}`)
assert.ok(happy.body.data.mood.valence > 55, 'happy conversation raises valence')

fs.rmSync(tempHome, { recursive: true, force: true })
console.log('mood-dj smoke: ok')
