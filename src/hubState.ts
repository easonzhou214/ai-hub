import { useCallback, useEffect, useRef, useState } from 'react'
import type { Provider } from './types'

/**
 * 共享状态仓库。
 *
 * 优先读写服务端的 `/api/state`（见 vite-plugins/state-store.ts），让同一个
 * 服务下的不同地址、不同设备看到同一份供应商与额度；服务端不可用（例如把
 * dist/ 纯静态部署）时自动退回 localStorage，行为与旧版本一致。
 *
 * 浏览器里仍保留一份 localStorage 缓存：首屏不用等服务端，断网也能打开。
 * 写入策略是「整份文档 + revision」：服务端版本号变了就拉取覆盖，冲突时以
 * 服务端为准，避免两端各写一半。
 */

export type HubStorageMode = 'server' | 'local'

export interface HubStateOptions {
  providerValidator: (value: unknown) => value is Provider[]
  readAccounts: () => unknown[]
  writeAccounts: (accounts: unknown[]) => void
  /** 服务端数据覆盖本地时触发，用于刷新账号列表等派生状态。 */
  onRemoteAccounts?: () => void
}

interface HubDoc {
  providers: Provider[]
  accounts: unknown[]
  lastSyncedAt: string
  autoSync: boolean
}

interface HubSnapshot extends HubDoc {
  revision: number
  updatedAt?: string
  empty?: boolean
}

const PROVIDERS_KEY = 'aihub.providers.v6'
const SYNCED_AT_KEY = 'aihub.syncedAt.v6'
const AUTO_SYNC_KEY = 'aihub.autoSync.v1'
const SAVE_DEBOUNCE_MS = 500
const POLL_INTERVAL_MS = 15_000
const REQUEST_TIMEOUT_MS = 3_000

function readCache<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeCache(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式下写不进去，内存状态仍然可用。
  }
}

function normalizeDoc(snapshot: HubSnapshot, validate: (value: unknown) => value is Provider[]): HubDoc {
  return {
    providers: validate(snapshot.providers) ? snapshot.providers : [],
    accounts: Array.isArray(snapshot.accounts) ? snapshot.accounts : [],
    lastSyncedAt:
      typeof snapshot.lastSyncedAt === 'string' ? snapshot.lastSyncedAt : '',
    autoSync: typeof snapshot.autoSync === 'boolean' ? snapshot.autoSync : true,
  }
}

/**
 * 首次加载时把服务端与本地缓存按 id 合并：服务端优先，同 id 取 updatedAt 较新的，
 * 本地独有的供应商保留。这样无论先打开哪台设备，都不会把另一台独有的配置吞掉。
 */
function mergeProviders(remote: Provider[], local: Provider[]) {
  const merged = [...remote]
  const index = new Map(remote.map((provider, position) => [provider.id, position]))
  for (const provider of local) {
    const position = index.get(provider.id)
    if (position === undefined) {
      merged.push(provider)
      continue
    }
    const current = merged[position]
    if (Date.parse(provider.updatedAt) > Date.parse(current.updatedAt)) {
      merged[position] = provider
    }
  }
  return merged
}

export function useHubState(options: HubStateOptions) {
  const [providers, setProviders] = useState<Provider[]>(() => {
    const cached = readCache<unknown>(PROVIDERS_KEY)
    return cached && options.providerValidator(cached) ? cached : []
  })
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(() => {
    const cached = readCache<unknown>(SYNCED_AT_KEY)
    return typeof cached === 'string' ? cached : ''
  })
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    const cached = readCache<unknown>(AUTO_SYNC_KEY)
    return typeof cached === 'boolean' ? cached : true
  })
  const [mode, setMode] = useState<HubStorageMode>('local')
  const [ready, setReady] = useState(false)
  const [hasData, setHasData] = useState(false)

  const optionsRef = useRef(options)
  optionsRef.current = options

  const providersRef = useRef(providers)
  const lastSyncedAtRef = useRef(lastSyncedAt)
  const autoSyncRef = useRef(autoSync)
  const modeRef = useRef<HubStorageMode>('local')
  const readyRef = useRef(false)
  const revisionRef = useRef(0)
  const appliedRef = useRef('')
  const inFlightRef = useRef(false)
  const pendingSaveRef = useRef(false)
  const saveTimerRef = useRef<number | undefined>(undefined)

  const buildDoc = useCallback((): HubDoc => {
    return {
      providers: providersRef.current,
      accounts: optionsRef.current.readAccounts(),
      lastSyncedAt: lastSyncedAtRef.current,
      autoSync: autoSyncRef.current,
    }
  }, [])

  const adopt = useCallback((snapshot: HubSnapshot) => {
    const doc = normalizeDoc(
      snapshot,
      optionsRef.current.providerValidator,
    )
    revisionRef.current = Number(snapshot.revision) || 0
    appliedRef.current = JSON.stringify(doc)
    providersRef.current = doc.providers
    lastSyncedAtRef.current = doc.lastSyncedAt
    autoSyncRef.current = doc.autoSync
    setProviders(doc.providers)
    setLastSyncedAt(doc.lastSyncedAt)
    setAutoSync(doc.autoSync)
    if (doc.accounts.length > 0) {
      optionsRef.current.writeAccounts(doc.accounts)
      optionsRef.current.onRemoteAccounts?.()
    }
  }, [])

  const flush = useCallback(
    async (baseRevision?: number) => {
      if (modeRef.current !== 'server') return
      const doc = buildDoc()
      const key = JSON.stringify(doc)
      if (key === appliedRef.current) return
      if (inFlightRef.current) {
        pendingSaveRef.current = true
        return
      }

      inFlightRef.current = true
      try {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            baseRevision: baseRevision ?? revisionRef.current,
            ...doc,
          }),
        })
        if (response.status === 409) {
          const payload = (await response.json().catch(() => null)) as
            | { state?: HubSnapshot }
            | null
          if (payload?.state) {
            adopt(payload.state)
            setHasData(true)
          }
          return
        }
        if (!response.ok) return
        const payload = (await response.json()) as { revision?: unknown }
        if (Number.isFinite(payload.revision)) {
          revisionRef.current = Number(payload.revision)
        }
        appliedRef.current = key
      } catch {
        // 断网或服务重启：保持本地状态，下一轮变更或轮询会重试。
      } finally {
        inFlightRef.current = false
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false
          window.setTimeout(() => void flush(), 0)
        }
      }
    },
    [adopt, buildDoc],
  )

  /** 主动用本机配置覆盖服务端（用于「服务端被别的设备先初始化」的场景）。 */
  const pushLocal = useCallback(async () => {
    if (modeRef.current !== 'server') return false
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const current = await fetch('/api/state', { cache: 'no-store' })
        if (!current.ok) return false
        const snapshot = (await current.json()) as HubSnapshot
        const baseRevision = Number(snapshot.revision) || 0
        const doc = buildDoc()
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ baseRevision, ...doc }),
        })
        if (response.status === 409) continue
        if (!response.ok) return false
        const payload = (await response.json()) as { revision?: unknown }
        revisionRef.current = Number(payload.revision) || baseRevision + 1
        appliedRef.current = JSON.stringify(doc)
        setHasData(doc.providers.length > 0)
        return true
      } catch {
        return false
      }
    }
    return false
  }, [buildDoc])

  const scheduleSave = useCallback(() => {
    if (modeRef.current !== 'server') return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined
      void flush()
    }, SAVE_DEBOUNCE_MS)
  }, [flush])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  // 任何状态变化：先落 localStorage 缓存，再按需写服务端。
  useEffect(() => {
    providersRef.current = providers
    lastSyncedAtRef.current = lastSyncedAt
    autoSyncRef.current = autoSync
    writeCache(PROVIDERS_KEY, providers)
    writeCache(SYNCED_AT_KEY, lastSyncedAt)
    writeCache(AUTO_SYNC_KEY, autoSync)
    if (!readyRef.current) return
    if (JSON.stringify(buildDoc()) === appliedRef.current) return
    scheduleSave()
  }, [autoSync, buildDoc, lastSyncedAt, providers, scheduleSave])

  // 首次加载：服务端有数据就用服务端的；服务端为空而本地有缓存，则把本地
  // 数据迁移上去（老用户第一次升级到这个版本时会走这里）。
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    const init = async () => {
      let snapshot: HubSnapshot | null = null
      try {
        const response = await fetch('/api/state', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (response.ok) {
          const parsed: unknown = await response.json()
          if (parsed && typeof parsed === 'object') {
            const candidate = parsed as HubSnapshot
            if (Array.isArray(candidate.providers)) snapshot = candidate
          }
        }
      } catch {
        snapshot = null
      } finally {
        window.clearTimeout(timer)
      }

      if (cancelled) return

      if (snapshot) {
        modeRef.current = 'server'
        setMode('server')
        revisionRef.current = Number(snapshot.revision) || 0
        if (snapshot.providers.length > 0) {
          const merged = mergeProviders(
            snapshot.providers,
            providersRef.current,
          )
          adopt({ ...snapshot, providers: merged })
          setHasData(true)
          // 本地有服务端没有的供应商（或版本更新），把合并结果推回服务端。
          if (merged.length !== snapshot.providers.length) {
            void pushLocal()
          }
        } else if (providersRef.current.length > 0) {
          setHasData(true)
          await flush(0)
        }
      } else if (providersRef.current.length > 0) {
        setHasData(true)
      }

      readyRef.current = true
      setReady(true)
    }

    void init()
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [adopt, flush, pushLocal])

  // 轮询：别的设备写入后，这边在 15 秒内跟上；标签页重新可见时立即拉一次。
  useEffect(() => {
    if (mode !== 'server') return
    let cancelled = false

    const poll = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const response = await fetch('/api/state', { cache: 'no-store' })
        if (!response.ok) return
        const parsed: unknown = await response.json()
        if (cancelled || !parsed || typeof parsed !== 'object') return
        const snapshot = parsed as HubSnapshot
        if (!Array.isArray(snapshot.providers)) return

        const revision = Number(snapshot.revision) || 0
        if (revision > revisionRef.current) {
          const remoteKey = JSON.stringify(
            normalizeDoc(snapshot, optionsRef.current.providerValidator),
          )
          if (remoteKey !== appliedRef.current) adopt(snapshot)
          return
        }
        // 版本没变但本地有未落盘的改动（例如上次写入失败），补一次。
        if (JSON.stringify(buildDoc()) !== appliedRef.current) void flush()
      } catch {
        // 服务端暂时不可达，下一轮再试。
      }
    }

    const interval = window.setInterval(poll, POLL_INTERVAL_MS)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    window.addEventListener('focus', handleVisible)
    window.addEventListener('online', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', handleVisible)
      window.removeEventListener('online', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [adopt, buildDoc, flush, mode])

  return {
    providers,
    setProviders,
    lastSyncedAt,
    setLastSyncedAt,
    autoSync,
    setAutoSync,
    mode,
    ready,
    hasData,
    requestSave: scheduleSave,
    pushLocal,
  }
}
