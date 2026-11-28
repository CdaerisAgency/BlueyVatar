import { afterEach, describe, expect, it, vi } from 'vitest'

const created: { listeners: Record<string, unknown[]> }[] = []
vi.mock('pg', () => {
  class Pool {
    listeners: Record<string, unknown[]> = {}
    constructor() {
      created.push(this)
    }
    on(event: string, fn: unknown) {
      ;(this.listeners[event] ??= []).push(fn)
      return this
    }
  }
  return { default: { Pool } }
})
vi.mock('./obs', () => ({ log: { warn: vi.fn() } }))

import { getLockPool } from './pool'

describe('getLockPool', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL
    delete (globalThis as Record<string, unknown>).__bvLockPool
    created.length = 0
  })

  it('is null without DATABASE_URL', () => {
    expect(getLockPool()).toBeNull()
  })

  it('creates one pool with exactly one error listener however often it is called', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test'
    for (let i = 0; i < 50; i++) getLockPool()
    expect(created).toHaveLength(1)
    expect(created[0]!.listeners.error).toHaveLength(1)
  })
})
