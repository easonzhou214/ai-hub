import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Last known quota snapshot per provider.
 *
 * The dashboard keeps its provider list in `localStorage`, which means every
 * browser (and every device) used to build its own stale copy. When a sync
 * failed, that copy kept showing「需要登录」forever even though the account was
 * fine. The local bridge now persists the last snapshot it actually managed to
 * read and hands it back with failed requests, so all clients converge on the
 * same data and a transient Chrome/CDP failure no longer rewrites the login
 * state.
 *
 * Snapshots only contain quota numbers and timestamps: no API keys, no tokens.
 */

const CACHE_PATH = join(homedir(), '.ai-hub', 'cache', 'usage-snapshots.json')
const MAX_ENTRIES = 64

export interface UsageSnapshot {
  sourceId: string
  payload: unknown
  cachedAt: string
}

let snapshots: Map<string, UsageSnapshot> | null = null

function load(): Map<string, UsageSnapshot> {
  if (snapshots) return snapshots
  snapshots = new Map()
  try {
    const raw = readFileSync(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const entries =
      parsed && typeof parsed === 'object'
        ? (parsed as { snapshots?: unknown }).snapshots
        : null
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const record = entry as Record<string, unknown>
        if (
          typeof record.sourceId !== 'string' ||
          typeof record.cachedAt !== 'string' ||
          !record.payload ||
          typeof record.payload !== 'object'
        ) {
          continue
        }
        snapshots.set(record.sourceId, {
          sourceId: record.sourceId,
          payload: record.payload,
          cachedAt: record.cachedAt,
        })
      }
    }
  } catch {
    // Missing or corrupt cache: start empty, the next successful sync fills it.
  }
  return snapshots
}

function persist(store: Map<string, UsageSnapshot>) {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    const entries = [...store.values()]
      .sort((a, b) => b.cachedAt.localeCompare(a.cachedAt))
      .slice(0, MAX_ENTRIES)
    const temp = `${CACHE_PATH}.tmp`
    writeFileSync(
      temp,
      JSON.stringify({ version: 1, snapshots: entries }, null, 2),
    )
    renameSync(temp, CACHE_PATH)
  } catch {
    // Cache is best-effort: never let a disk problem break quota sync.
  }
}

export function saveUsageSnapshot(sourceId: string, payload: unknown) {
  if (!sourceId || !payload || typeof payload !== 'object') return
  const store = load()
  const entry: UsageSnapshot = {
    sourceId,
    payload,
    cachedAt: new Date().toISOString(),
  }
  store.set(sourceId, entry)
  if (store.size > MAX_ENTRIES) {
    const oldest = [...store.values()].sort((a, b) =>
      a.cachedAt.localeCompare(b.cachedAt),
    )[0]
    if (oldest) store.delete(oldest.sourceId)
  }
  persist(store)
}

export function getUsageSnapshot(sourceId: string): UsageSnapshot | null {
  if (!sourceId) return null
  return load().get(sourceId) ?? null
}
