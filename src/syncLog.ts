import type { Provider } from './types'

/** Mirrors the JSONL entries written by `vite-plugins/sync-log.ts`. */
export interface SyncLogEvent {
  ts: string
  level: 'info' | 'warn' | 'error'
  layer: 'server' | 'client'
  phase: string
  provider?: string
  sourceId?: string
  attempt?: number
  durationMs?: number
  message: string
  code?: string
  httpStatus?: number
}

export interface SyncLogSnapshot {
  path: string
  events: SyncLogEvent[]
}

export async function fetchSyncLogs(limit = 100): Promise<SyncLogSnapshot> {
  let response: Response
  try {
    response = await fetch(
      `/api/cc-switch/logs?limit=${encodeURIComponent(String(limit))}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' },
    )
  } catch {
    throw new Error('无法连接本地同步服务')
  }

  if (!response.ok) {
    throw new Error(`无法读取同步日志（HTTP ${response.status}）`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('同步日志接口返回了非 JSON 数据')
  }

  const record =
    payload && typeof payload === 'object'
      ? (payload as { path?: unknown; events?: unknown })
      : {}
  return {
    path: typeof record.path === 'string' ? record.path : '',
    events: Array.isArray(record.events)
      ? (record.events as SyncLogEvent[])
      : [],
  }
}

/**
 * PixelLab is called directly from the browser (no local bridge hop), so its
 * failures would otherwise be missing from the server-side log. This is
 * fire-and-forget: diagnostics must never break a sync.
 */
export function reportSyncFailure(
  provider: Pick<Provider, 'name' | 'sourceId' | 'syncMode'>,
  error: unknown,
  durationMs?: number,
) {
  const message =
    error instanceof Error ? error.message : String(error || '同步失败')
  const code =
    error instanceof Error && error.name && error.name !== 'Error'
      ? error.name
      : undefined

  void fetch('/api/cc-switch/log', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      level: 'error',
      phase: 'client-sync',
      provider: provider.name,
      sourceId: provider.sourceId,
      syncMode: provider.syncMode,
      message: message.slice(0, 500),
      code,
      durationMs,
    }),
  }).catch(() => {
    // Server may be restarting; the UI already shows the failure.
  })
}
