import { readdirSync, readFileSync } from 'node:fs'

/**
 * Linux-only process sampler. Reads /proc, so it works for the server tree and a local
 * Postgres on the same machine. It does nothing useful against a remote staging host; use
 * the Fly and Neon dashboards for those (see docs/research/load-test-v1.md).
 */

const CLK_TCK = 100 // sysconf(_SC_CLK_TCK) on Linux is 100 on every common build.

function readStat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = raw.lastIndexOf(')')
    const comm = raw.slice(raw.indexOf('(') + 1, close)
    const f = raw.slice(close + 2).split(' ')
    // f[0] state, f[1] ppid, f[11] utime, f[12] stime, f[13] cutime, f[14] cstime (reaped children), f[21] rss pages
    return { pid: Number(pid), comm, ppid: Number(f[1]), jiffies: Number(f[11]) + Number(f[12]), childJiffies: Number(f[13]) + Number(f[14]), rssKb: Number(f[21]) * 4 }
  } catch {
    return null
  }
}

function allProcs() {
  const out = []
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const s = readStat(name)
    if (s) out.push(s)
  }
  return out
}

/** Server process plus all descendants, with the sharp resize children split out. */
export function sampleTree(rootPid) {
  const procs = allProcs()
  const kids = new Map()
  for (const p of procs) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p)
  const root = procs.find((p) => p.pid === rootPid)
  if (!root) return null
  const children = []
  const walk = (pid) => { for (const k of kids.get(pid) ?? []) { children.push(k); walk(k.pid) } }
  walk(rootPid)
  return {
    // Live children plus the CPU of children the server already reaped (resize workers exit after each job).
    jiffies: root.jiffies + root.childJiffies + children.reduce((a, c) => a + c.jiffies, 0),
    rootRssKb: root.rssKb,
    childRssKb: children.reduce((a, c) => a + c.rssKb, 0),
    childCount: children.length,
  }
}

/** Postgres backends and helpers on this machine: comm starts with "postgres" (or "postmaster"). Per-pid jiffies. */
export function samplePostgres() {
  const procs = allProcs().filter((p) => /^(postgres|postmaster)/.test(p.comm))
  return { byPid: new Map(procs.map((p) => [p.pid, p.jiffies])), procs: procs.length }
}

/** CPU jiffies used between two samples by processes present in both (a backend that exits mid-interval is ignored). */
export function postgresDeltaJiffies(prev, cur) {
  let d = 0
  for (const [pid, j] of cur.byPid) { const before = prev.byPid.get(pid); if (before !== undefined) d += j - before }
  return d
}

export const jiffiesToCores = (deltaJiffies, deltaSeconds) => deltaJiffies / CLK_TCK / deltaSeconds
