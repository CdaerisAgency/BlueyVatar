// Open-loop load generator for delivery (issue #149). No dependencies beyond node and core.
// Latency is measured from each request's scheduled send time, so a stalled server shows up as
// latency instead of silently lowering the offered rate (no coordinated omission).
//
//   node src/run.mjs --base http://127.0.0.1:3101 --targets targets.json --scenario all \
//     --rps 10,50,200 --duration 20 --pid <server pid> --pg-url postgres://postgres@localhost/bv_loadtest
import http from 'node:http'
import https from 'node:https'
import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { loadavg, cpus } from 'node:os'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { imagePath } from '@blueyvatar/core'
import { assertTargetAllowed } from './guard.mjs'
import { jiffiesToCores, postgresDeltaJiffies, samplePostgres, sampleTree } from './sampler.mjs'
import { summarize } from './stats.mjs'

const { values: a } = parseArgs({
  options: {
    base: { type: 'string' },
    targets: { type: 'string', default: 'targets.json' },
    scenario: { type: 'string', default: 'all' },
    rps: { type: 'string', default: '10,50,200' },
    duration: { type: 'string', default: '20' },
    pid: { type: 'string' },
    'pg-url': { type: 'string' },
    out: { type: 'string', default: 'results.json' },
    'spoof-ip': { type: 'boolean' },
    'img-sizes': { type: 'string', default: '64,128,256,512' },
    'max-inflight': { type: 'string' },
    'i-know': { type: 'boolean', default: false },
  },
})
if (!a.base) { console.error('Usage: run.mjs --base <url> [--targets f] [--scenario name|all] [--rps 10,50,200] [--duration s] [--pid n] [--pg-url url]'); process.exit(1) }

const target = assertTargetAllowed(a.base, a['i-know'])
const base = new URL(a.base)
// cf-connecting-ip only means something when the origin trusts it. Default on for loopback only.
const spoofIp = a['spoof-ip'] ?? target.kind === 'loopback'
const targets = JSON.parse(readFileSync(a.targets, 'utf8'))
const signingSecret = process.env.IMG_SIGNING_SECRET ?? 'loadtest-local-secret'
const originSecret = process.env.ORIGIN_SECRET
const imgSizes = a['img-sizes'].split(',').map(Number)
const FORMATS = ['png', 'jpeg', 'webp']

const lib = base.protocol === 'https:' ? https : http
const agent = new lib.Agent({ keepAlive: true, maxSockets: 1024 })

const pick = (arr) => arr[randomInt(arr.length)]
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`

// Cold pools: indexes handed out once, so no handle repeats within a process.
let coldHandle = 1000
let coldImg = 0
const warmHandles = targets.handles.slice(0, 50)
const warmHashes = targets.hashes.slice(0, 1000)

/** Each scenario returns { path, headers } for one request, plus an optional warm-up list. */
const SCENARIOS = {
  'avatar-anon': { desc: '/avatar/{hash}, no key, one rate bucket per client IP', build: () => ({ path: `/avatar/${pick(warmHashes)}?s=128` }), warm: () => warmHashes.map((h) => `/avatar/${h}?s=128`) },
  'avatar-keyed-hot': { desc: '/avatar/{hash} with one key (one hot rate row and usage row)', build: () => ({ path: `/avatar/${pick(warmHashes)}?s=128`, headers: { 'x-api-key': targets.keys[0] } }), warm: () => warmHashes.map((h) => `/avatar/${h}?s=128`) },
  'avatar-keyed-spread': { desc: '/avatar/{hash} spread over all seeded keys', build: () => ({ path: `/avatar/${pick(warmHashes)}?s=128`, headers: { 'x-api-key': pick(targets.keys) } }), warm: () => warmHashes.map((h) => `/avatar/${h}?s=128`) },
  'u-warm': { desc: '/u/{handle}, resolver cache warm', build: () => ({ path: `/u/${pick(warmHandles)}?s=128` }), warm: () => warmHandles.map((h) => `/u/${h}?s=128`) },
  'u-cold': { desc: '/u/{handle}, every handle new to the resolver cache', build: () => {
    if (coldHandle >= targets.handles.length) throw new Error('cold handle pool exhausted; seed more identities')
    return { path: `/u/${targets.handles[coldHandle++]}?s=128` }
  } },
  'img-cold': { desc: '/img transform, every variant new (resize in the sharp child)', build: () => {
    const i = coldImg++
    const im = targets.images[i % targets.images.length]
    const size = imgSizes[Math.floor(i / targets.images.length) % imgSizes.length]
    const fmt = FORMATS[Math.floor(i / (targets.images.length * imgSizes.length)) % FORMATS.length]
    return { path: imagePath(signingSecret, im.did, im.cid, size, fmt) }
  } },
  'profile': { desc: '/profile/{handle} JSON, resolver cache warm', build: () => ({ path: `/profile/${pick(warmHandles)}` }), warm: () => warmHandles.map((h) => `/profile/${h}`) },
}

function fire(path, extra, signal) {
  return new Promise((resolve) => {
    const headers = { ...extra }
    if (spoofIp) headers['cf-connecting-ip'] = ip()
    if (originSecret) headers['x-origin-auth'] = originSecret
    const req = lib.request({ host: base.hostname, port: base.port || undefined, path, method: 'GET', agent, headers }, (res) => {
      let bytes = 0
      res.on('data', (d) => { bytes += d.length })
      res.on('end', () => resolve({ status: res.statusCode, bytes }))
      res.on('error', () => resolve({ status: 0, bytes }))
    })
    req.setTimeout(30_000, () => { req.destroy(); resolve({ status: 0, bytes: 0 }) })
    req.on('error', () => resolve({ status: 0, bytes: 0 }))
    req.end()
  })
}

async function runOne(name, rps, durationS, pgPool) {
  const sc = SCENARIOS[name]
  if (sc.warm) { for (const p of sc.warm()) await fire(p, name.startsWith('avatar-keyed') ? { 'x-api-key': targets.keys[0] } : {}) }
  const lat = []
  const status = new Map()
  let sent = 0, dropped = 0, inflight = 0, bytes = 0
  const total = Math.round(rps * durationS)
  // img-cold forks one sharp child per request with no cap in the server (itself a finding), so the
  // generator sheds load past 100 in flight to protect the machine. Shed requests count as dropped.
  const maxInflight = Number(a['max-inflight'] ?? (name === 'img-cold' ? 100 : 4000))

  // Resource sampling once a second.
  const samples = []
  const pid = a.pid ? Number(a.pid) : null
  let prevTree = pid ? sampleTree(pid) : null
  let prevPg = a['pg-url'] ? samplePostgres() : null
  let prevT = performance.now()
  const sampler = setInterval(async () => {
    const t = performance.now()
    const dt = (t - prevT) / 1000
    const s = {}
    if (pid) {
      const cur = sampleTree(pid)
      if (cur && prevTree) { s.serverCores = jiffiesToCores(cur.jiffies - prevTree.jiffies, dt); s.rootRssMb = cur.rootRssKb / 1024; s.childRssMb = cur.childRssKb / 1024; s.childCount = cur.childCount }
      prevTree = cur
    }
    if (pgPool) {
      const cur = samplePostgres()
      if (prevPg) { s.pgCores = jiffiesToCores(postgresDeltaJiffies(prevPg, cur), dt) }
      prevPg = cur
      try { s.pgConns = Number((await pgPool.query(`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()`)).rows[0].count) } catch { /* ignore */ }
    }
    samples.push(s)
    prevT = t
  }, 1000)

  const t0 = performance.now()
  const pending = []
  for (let i = 0; i < total; i++) {
    const due = t0 + (i * 1000) / rps
    const wait = due - performance.now()
    if (wait > 1) await new Promise((r) => setTimeout(r, wait))
    if (inflight >= maxInflight) { dropped++; continue }
    const { path, headers } = sc.build()
    sent++
    inflight++
    pending.push(fire(path, headers).then((r) => {
      inflight--
      lat.push(performance.now() - due)
      status.set(r.status, (status.get(r.status) ?? 0) + 1)
      bytes += r.bytes
    }))
  }
  const dispatchS = (performance.now() - t0) / 1000
  await Promise.all(pending)
  clearInterval(sampler)

  const ok = [...status].filter(([s]) => s >= 200 && s < 400).reduce((n, [, c]) => n + c, 0)
  const limited = status.get(429) ?? 0
  // 503 is the origin shedding on purpose (resize queue full, issue #198). It is reported apart from real errors.
  const overloaded = status.get(503) ?? 0
  const errors = sent - ok - limited - overloaded
  const agg = (k, f) => { const v = samples.map((s) => s[k]).filter((x) => x !== undefined); return v.length ? f(v) : null }
  const avg = (v) => v.reduce((x, y) => x + y, 0) / v.length
  const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10)
  const l = summarize(lat)
  return {
    scenario: name, targetRps: rps, durationS, sent, dropped, offeredRps: r1((sent + dropped) / dispatchS), sentRps: r1(sent / dispatchS),
    ok, rateLimited: limited, overloaded503: overloaded, errors, errorRate: r1((errors / Math.max(1, sent)) * 100),
    status: Object.fromEntries(status),
    p50: r1(l.p50), p95: r1(l.p95), p99: r1(l.p99), max: r1(l.max),
    mbPerS: r1(bytes / 1e6 / dispatchS),
    serverCoresAvg: r1(agg('serverCores', avg)), serverCoresMax: r1(agg('serverCores', (v) => Math.max(...v))),
    rootRssMbMax: r1(agg('rootRssMb', (v) => Math.max(...v))),
    childRssMbMax: r1(agg('childRssMb', (v) => Math.max(...v))), childCountMax: agg('childCount', (v) => Math.max(...v)),
    pgCoresAvg: r1(agg('pgCores', avg)), pgCoresMax: r1(agg('pgCores', (v) => Math.max(...v))), pgConnsMax: agg('pgConns', (v) => Math.max(...v)),
  }
}

const names = a.scenario === 'all' ? Object.keys(SCENARIOS) : a.scenario.split(',')
for (const n of names) if (!SCENARIOS[n]) { console.error(`unknown scenario ${n}; known: ${Object.keys(SCENARIOS).join(', ')}`); process.exit(1) }
const rates = a.rps.split(',').map(Number)
const pgPool = a['pg-url'] ? new pg.Pool({ connectionString: a['pg-url'], max: 1 }) : null

console.log(`target ${base.origin} (${target.kind}), spoof-ip=${spoofIp}, duration ${a.duration}s per step`)
const results = []
for (const n of names) {
  for (const rps of rates) {
    const la0 = loadavg()[0]
    const r = await runOne(n, rps, Number(a.duration), pgPool)
    // One-minute load average before the step; a value above the core count means the machine was shared or busy.
    r.loadBefore = Math.round(la0 * 10) / 10
    r.cores = cpus().length
    results.push(r)
    console.log(JSON.stringify(r))
    await new Promise((res) => setTimeout(res, 2000)) // let queues and resize children drain
  }
}
writeFileSync(a.out, JSON.stringify({ target: base.origin, kind: target.kind, at: new Date().toISOString(), results }, null, 2))
console.log(`wrote ${a.out}`)
await pgPool?.end()
agent.destroy()
