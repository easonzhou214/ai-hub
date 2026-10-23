import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccountManager } from './components/AccountManager'
import { BootScreen } from './components/BootScreen'
import { LoginDialog, type LoginUiState } from './components/LoginDialog'
import { LoginPage } from './components/LoginPage'
import { ConfirmDialog, Toast, type ConfirmState } from './components/Overlays'
import { ProviderDrawer } from './components/ProviderDrawer'
import { Sidebar } from './components/Sidebar'
import { SyncLogDialog } from './components/SyncLogDialog'
import { TopBar } from './components/TopBar'
import {
  authenticate,
  clearSession,
  createAccount,
  deleteAccount,
  getAccounts,
  loadSession,
  replaceAccounts,
  saveSession,
  type Account,
  type AccountInput,
} from './auth'
import {
  applyBillingSnapshot,
  fetchProviderBilling,
  readableSyncError,
} from './billing'
import {
  ccSwitchProviderToProvider,
  fetchCcSwitchProviders,
} from './ccSwitch'
import {
  fetchCodexCurrent,
  findCodexProvider,
  type CodexCurrentSnapshot,
} from './codex'
import { createSeedProviders, createSeedSyncedAt } from './data'
import { useHubState } from './hubState'
import { Overview } from './pages/Overview'
import { ProvidersPage } from './pages/Providers'
import { UsagePage } from './pages/Usage'
import { reportSyncFailure } from './syncLog'
import type {
  PageKey,
  Provider,
  ProviderDraft,
  ProviderPreset,
  ProviderType,
} from './types'
import {
  clamp,
  isInterfaceSynced,
  loginBrand,
  providerAlerts,
} from './utils'

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000
const PAGE_KEYS: PageKey[] = ['overview', 'providers', 'usage']

function parsePageFromHash(): PageKey {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return PAGE_KEYS.includes(raw as PageKey) ? (raw as PageKey) : 'overview'
}

function isProviderArray(value: unknown): value is Provider[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Provider).id === 'string' &&
        typeof (item as Provider).name === 'string' &&
        ((item as Provider).type === 'coding' ||
          (item as Provider).type === 'image'),
    )
  )
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function simulateProviderUpdate(provider: Provider): Provider {
  if (!provider.enabled) return provider
  const now = new Date().toISOString()
  const addedCalls =
    Math.max(2, Math.round(provider.callsToday * 0.04)) +
    (provider.callsToday % 5)
  if (provider.billing === 'quota') {
    const increment = provider.quotaTotal * (0.008 + Math.random() * 0.01)
    return {
      ...provider,
      quotaUsed: roundMoney(
        clamp(provider.quotaUsed + increment, 0, provider.quotaTotal),
      ),
      callsToday: provider.callsToday + addedCalls,
      updatedAt: now,
    }
  }
  const base = provider.monthlyBudget || Math.max(provider.balance, 10)
  const spend = base * (0.004 + Math.random() * 0.007)
  const deducted = Math.min(provider.balance, spend)
  return {
    ...provider,
    balance: roundMoney(Math.max(provider.balance - deducted, 0)),
    monthlySpend: roundMoney(provider.monthlySpend + deducted),
    callsToday: provider.callsToday + addedCalls,
    updatedAt: now,
  }
}

async function syncImportedProviders(providers: Provider[]) {
  let syncedCount = 0
  const synced = await Promise.all(
    providers.map(async (provider) => {
      try {
        const snapshot = await fetchProviderBilling(provider)
        syncedCount += 1
        return applyBillingSnapshot(provider, snapshot)
      } catch (error) {
        return {
          ...provider,
          syncError: readableSyncError(error),
          updatedAt: new Date().toISOString(),
        }
      }
    }),
  )
  return { providers: synced, syncedCount }
}

export default function App() {
  const [user, setUser] = useState<Account | null>(() => loadSession())
  const [accounts, setAccounts] = useState<Account[]>(() => getAccounts())

  // 供应商、额度、账号由服务端统一保存（静态部署时退回 localStorage）。
  const {
    providers,
    setProviders,
    lastSyncedAt,
    setLastSyncedAt,
    autoSync,
    setAutoSync,
    mode: storageMode,
    ready: hubReady,
    hasData: hubHasData,
    requestSave: requestHubSave,
    pushLocal,
  } = useHubState({
    providerValidator: isProviderArray,
    readAccounts: getAccounts,
    writeAccounts: replaceAccounts,
    onRemoteAccounts: () => setAccounts(getAccounts()),
  })

  const [codexCurrent, setCodexCurrent] = useState<CodexCurrentSnapshot | null>(
    null,
  )
  const [booted, setBooted] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [bootMessage, setBootMessage] = useState('正在载入已保存的配置…')
  const [importing, setImporting] = useState(false)
  const [page, setPage] = useState<PageKey>(parsePageFromHash)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPreset, setDrawerPreset] = useState<ProviderPreset | null>(null)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [initialType, setInitialType] = useState<ProviderType>('coding')
  const [syncing, setSyncing] = useState(false)
  const [login, setLogin] = useState<LoginUiState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [toast, setToast] = useState<{
    id: number
    message: string
    tone: 'success' | 'error'
  } | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const syncingRef = useRef(false)

  const notify = useCallback(
    (message: string, tone: 'success' | 'error' = 'success') => {
      setToast({ id: Date.now(), message, tone })
    },
    [],
  )

  const refreshCodexCurrent = useCallback(async () => {
    const next = await fetchCodexCurrent()
    // Keep the last marker through transient bridge failures.
    if (next) setCodexCurrent(next)
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  const handleSignIn = useCallback((username: string, password: string) => {
    const account = authenticate(username, password)
    if (!account) return '用户名或密码不正确'
    saveSession(account)
    setUser(account)
    setAccounts(getAccounts())
    return null
  }, [])

  const handleLogout = useCallback(() => {
    clearSession()
    setUser(null)
    setAccountsOpen(false)
    setDrawerOpen(false)
    setLogsOpen(false)
    setLogin(null)
  }, [])

  const handleCreateAccount = useCallback(
    (input: AccountInput) => {
      const result = createAccount(input)
      if (!result.ok) return result.error
      setAccounts(getAccounts())
      requestHubSave()
      notify(`已添加普通账号 ${result.account.username}`)
      return null
    },
    [notify, requestHubSave],
  )

  const handleDeleteAccount = useCallback(
    (account: Account) => {
      if (!deleteAccount(account.id)) {
        notify('管理员账号不可删除', 'error')
        return
      }
      setAccounts(getAccounts())
      requestHubSave()
      notify(`已删除账号 ${account.username}`)
    },
    [notify, requestHubSave],
  )

  const handlePushLocal = useCallback(async () => {
    const ok = await pushLocal()
    notify(
      ok ? '已用本机配置覆盖服务端' : '推送失败：当前没有连接服务端',
      ok ? 'success' : 'error',
    )
  }, [notify, pushLocal])

  const navigate = useCallback((next: PageKey) => {
    setPage(next)
    window.location.hash = `/${next}`
  }, [])

  useEffect(() => {
    const handleHash = () => setPage(parsePageFromHash())
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    const titles: Record<PageKey, string> = {
      overview: '概览',
      providers: '供应商',
      usage: '使用额度',
    }
    document.title = `${titles[page]} · AI Hub`
  }, [page])

  useEffect(() => {
    if (booted || !user || !hubReady) return

    // 服务端（或本地缓存）里已经有供应商，直接进入界面，不再重复导入。
    if (hubHasData) {
      setBooted(true)
      return
    }

    let cancelled = false

    const boot = async () => {
      try {
        setBootMessage('正在从 CC Switch 读取供应商…')
        const configs = await fetchCcSwitchProviders()
        if (cancelled) return
        if (!configs.length) {
          throw new Error('CC Switch 中没有可导入的 Codex 供应商')
        }

        const imported = configs.map((config, index) =>
          ccSwitchProviderToProvider(config, undefined, index),
        )
        setBootMessage('正在读取供应商额度…')
        const result = await syncImportedProviders(imported)
        if (cancelled) return

        setProviders(result.providers)
        if (result.syncedCount > 0) {
          setLastSyncedAt(new Date().toISOString())
        }
        setBooted(true)
        notify(
          result.syncedCount > 0
            ? `已从 CC Switch 接入 ${result.providers.length} 个供应商`
            : `已接入 ${result.providers.length} 个供应商，额度同步待重试`,
        )
      } catch {
        if (cancelled) return
        setProviders(createSeedProviders())
        setLastSyncedAt(createSeedSyncedAt())
        setBooted(true)
        notify('未读取到 CC Switch 配置，已载入演示数据')
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [
    booted,
    hubHasData,
    hubReady,
    notify,
    setLastSyncedAt,
    setProviders,
    user,
  ])

  // Pick up providers added to CC Switch after the initial import. Runs once
  // per app load; the explicit import button remains the way to refresh config.
  useEffect(() => {
    if (!booted || !user) return
    let cancelled = false

    const addNewProviders = async () => {
      try {
        const configs = await fetchCcSwitchProviders()
        const known = new Set(
          providers
            .map((provider) => provider.sourceId)
            .filter((sourceId): sourceId is string => Boolean(sourceId)),
        )
        const newConfigs = configs.filter(
          (config) => !known.has(config.sourceId),
        )
        if (newConfigs.length === 0) return

        const imported = newConfigs.map((config, index) =>
          ccSwitchProviderToProvider(
            config,
            undefined,
            providers.length + index,
          ),
        )
        const result = await syncImportedProviders(imported)
        if (cancelled) return

        setProviders((current) => {
          const knownIds = new Set(current.map((provider) => provider.id))
          const knownSources = new Set(
            current
              .map((provider) => provider.sourceId)
              .filter((sourceId): sourceId is string => Boolean(sourceId)),
          )
          const additions = result.providers.filter(
            (provider) =>
              !knownIds.has(provider.id) &&
              !(provider.sourceId && knownSources.has(provider.sourceId)),
          )
          return additions.length ? [...additions, ...current] : current
        })
        setLastSyncedAt(new Date().toISOString())
        notify(
          result.syncedCount > 0
            ? `已从 CC Switch 同步 ${result.providers.length} 个新供应商`
            : `已导入 ${result.providers.length} 个新供应商，额度待补录`,
        )
      } catch {
        // Silent: the explicit import button reports actionable errors.
      }
    }

    void addNewProviders()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, user])

  const alerts = useMemo(
    () =>
      providers
        .flatMap((provider) => providerAlerts(provider))
        .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'expire' ? -1 : 1)),
    [providers],
  )

  const openAdd = useCallback(
    (type?: ProviderType, preset?: ProviderPreset) => {
      setEditing(null)
      setInitialType(type ?? (preset === 'pixellab' ? 'image' : 'coding'))
      setDrawerPreset(preset ?? null)
      setDrawerOpen(true)
    },
    [],
  )

  const openEdit = useCallback((provider: Provider) => {
    setEditing(provider)
    setInitialType(provider.type)
    setDrawerPreset(null)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setDrawerPreset(null)
  }, [])

  const handleSave = useCallback(
    (draft: ProviderDraft) => {
      const isEdit = providers.some((provider) => provider.id === draft.id)
      const now = new Date().toISOString()
      const nextProvider: Provider = {
        ...draft,
        id: draft.id ?? crypto.randomUUID(),
        createdAt: draft.createdAt ?? now,
        updatedAt: draft.updatedAt ?? now,
      }
      setProviders((current) =>
        isEdit
          ? current.map((provider) =>
              provider.id === nextProvider.id ? nextProvider : provider,
            )
          : [nextProvider, ...current],
      )
      setDrawerOpen(false)
      setEditing(null)
      notify(isEdit ? '已保存供应商配置' : '已添加供应商')

      // PixelLab 没有 CC Switch 缓存，保存后立刻拉一次额度，避免用户还要等
      // 自动同步（5 分钟）或手动点同步。
      if (nextProvider.syncMode === 'pixellab' && nextProvider.enabled) {
        void (async () => {
          const startedAt = Date.now()
          try {
            const snapshot = await fetchProviderBilling(nextProvider)
            setProviders((current) =>
              current.map((provider) =>
                provider.id === nextProvider.id
                  ? applyBillingSnapshot(provider, snapshot)
                  : provider,
              ),
            )
            setLastSyncedAt(snapshot.syncedAt)
            notify(`已读取 ${nextProvider.name} 的 PixelLab 额度`)
          } catch (error) {
            const message = readableSyncError(error)
            reportSyncFailure(nextProvider, error, Date.now() - startedAt)
            setProviders((current) =>
              current.map((provider) =>
                provider.id === nextProvider.id
                  ? {
                      ...provider,
                      syncError: message,
                      updatedAt: new Date().toISOString(),
                    }
                  : provider,
              ),
            )
            notify(`${nextProvider.name} 额度读取失败：${message}`, 'error')
          }
        })()
      }
    },
    [notify, providers, setLastSyncedAt, setProviders],
  )

  const handleToggle = useCallback(
    (provider: Provider) => {
      const nextEnabled = !provider.enabled
      setProviders((current) =>
        current.map((item) =>
          item.id === provider.id
            ? { ...item, enabled: nextEnabled, updatedAt: new Date().toISOString() }
            : item,
        ),
      )
      notify(`${nextEnabled ? '已启用' : '已停用'} ${provider.name}`)
    },
    [notify, setProviders],
  )

  const handleDelete = useCallback(
    (provider: Provider) => {
      setConfirm({
        title: `删除 ${provider.name}？`,
        description:
          '该供应商的名称、API Key 与额度记录会从本地移除，操作无法撤销。',
        confirmLabel: '删除供应商',
        tone: 'danger',
        onConfirm: () => {
          setProviders((current) =>
            current.filter((item) => item.id !== provider.id),
          )
          if (editing?.id === provider.id) {
            setDrawerOpen(false)
            setEditing(null)
          }
          notify(`已删除 ${provider.name}`)
        },
      })
    },
    [editing, notify, setProviders],
  )

  const handleReset = useCallback(() => {
    setConfirm({
      title: '重置为演示数据？',
      description:
        '会恢复 8 个示例供应商与初始额度，当前浏览器里的配置将被覆盖。之后仍可从 CC Switch 重新导入。',
      confirmLabel: '恢复演示数据',
      tone: 'neutral',
      onConfirm: () => {
        setProviders(createSeedProviders())
        setLastSyncedAt(createSeedSyncedAt())
        setDrawerOpen(false)
        setEditing(null)
        navigate('overview')
        notify('已恢复演示数据')
      },
    })
  }, [navigate, notify, setLastSyncedAt, setProviders])

  const handleExport = useCallback(() => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      providers: providers.map(({ apiKey, ...rest }) => ({
        ...rest,
        hasApiKey: Boolean(apiKey),
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    anchor.href = url
    anchor.download = `ai-hub-providers-${stamp}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    notify('供应商配置已导出')
  }, [notify, providers])

  const handleImport = useCallback(async () => {
    if (importing) return
    setImporting(true)
    try {
      const configs = await fetchCcSwitchProviders()
      if (!configs.length) {
        throw new Error('CC Switch 中没有可导入的 Codex 供应商')
      }
      const existingBySource = new Map(
        providers
          .filter((provider) => provider.sourceId)
          .map((provider) => [provider.sourceId as string, provider]),
      )
      const imported = configs.map((config, index) =>
        ccSwitchProviderToProvider(
          config,
          existingBySource.get(config.sourceId),
          index,
        ),
      )
      const result = await syncImportedProviders(imported)
      setProviders((current) => [
        ...result.providers,
        ...current.filter((provider) => provider.source !== 'cc-switch'),
      ])
      setLastSyncedAt(new Date().toISOString())
      notify(
        result.syncedCount > 0
          ? `已从 CC Switch 导入 ${result.providers.length} 个供应商并同步额度`
          : `已导入 ${result.providers.length} 个供应商，额度同步失败`,
      )
    } catch (error) {
      notify(readableSyncError(error), 'error')
    } finally {
      setImporting(false)
    }
  }, [importing, notify, providers, setLastSyncedAt, setProviders])

  const runSync = useCallback(
    async (silent: boolean) => {
      if (syncingRef.current) return
      if (!providers.some((provider) => provider.enabled)) {
        if (!silent) notify('没有启用的供应商可同步')
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!silent) notify('网络已断开，恢复网络后会自动重试', 'error')
        return
      }
      syncingRef.current = true
      setSyncing(true)
      try {
        let realSynced = 0
        const failures: Array<{ name: string; message: string }> = []
        const now = new Date().toISOString()
        const updated = await Promise.all(
          providers.map(async (provider) => {
            if (!provider.enabled) return provider
            if (isInterfaceSynced(provider)) {
              const startedAt = Date.now()
              try {
                const snapshot = await fetchProviderBilling(provider)
                realSynced += 1
                return applyBillingSnapshot(provider, snapshot)
              } catch (error) {
                const message = readableSyncError(error)
                const raw =
                  error instanceof Error ? error.message : String(error ?? '')
                if (provider.syncMode === 'pixellab' || /无法连接本地/.test(raw)) {
                  reportSyncFailure(provider, error, Date.now() - startedAt)
                }
                failures.push({ name: provider.name, message })
                return {
                  ...provider,
                  syncError: message,
                  updatedAt: now,
                }
              }
            }
            return simulateProviderUpdate(provider)
          }),
        )
        setProviders(updated)
        setLastSyncedAt(now)
        void refreshCodexCurrent()
        if (!silent) {
          if (failures.length > 0) {
            const first = failures[0]
            const extra =
              failures.length > 1 ? ` 等 ${failures.length} 个` : ''
            const reason =
              first.message.length > 64
                ? `${first.message.slice(0, 64)}…`
                : first.message
            notify(
              `已同步 ${realSynced} 个，${first.name}${extra}失败：${reason}`,
              'error',
            )
          } else if (realSynced > 0) {
            notify(`已同步 ${realSynced} 个接口供应商的最新额度`)
          } else {
            notify(
              `已同步 ${providers.filter((provider) => provider.enabled).length} 个供应商的额度`,
            )
          }
        }
      } finally {
        syncingRef.current = false
        setSyncing(false)
      }
    },
    [notify, providers, refreshCodexCurrent, setLastSyncedAt, setProviders],
  )

  const handleRefresh = useCallback(() => {
    void runSync(false)
  }, [runSync])

  const runSyncRef = useRef(runSync)
  const lastSyncedAtRef = useRef(lastSyncedAt)
  const providersRef = useRef(providers)

  useEffect(() => {
    runSyncRef.current = runSync
  }, [runSync])

  useEffect(() => {
    lastSyncedAtRef.current = lastSyncedAt
  }, [lastSyncedAt])

  useEffect(() => {
    providersRef.current = providers
  }, [providers])

  // Auto sync: refresh stale data on load, every few minutes, and after the
  // machine wakes or the network comes back. After wake-from-sleep Safari can
  // become visible before Wi-Fi/DNS is ready, so wait before hitting APIs.
  useEffect(() => {
    if (!booted || !autoSync || !user) return

    const isStale = () => {
      const last = new Date(lastSyncedAtRef.current).getTime()
      return Number.isNaN(last) || Date.now() - last >= AUTO_SYNC_INTERVAL_MS
    }
    const needsSync = () =>
      isStale() ||
      providersRef.current.some(
        (provider) => provider.enabled && provider.syncError,
      )

    let wakeTimer = 0
    let initialTimer = 0
    const syncNow = () => {
      if (document.visibilityState === 'visible') {
        void runSyncRef.current(true)
      }
    }
    const scheduleSync = (delayMs: number) => {
      window.clearTimeout(wakeTimer)
      wakeTimer = window.setTimeout(syncNow, delayMs)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && needsSync()) {
        scheduleSync(1_500)
      }
    }
    const handleOnline = () => {
      if (document.visibilityState === 'visible') scheduleSync(600)
    }

    if (needsSync()) initialTimer = window.setTimeout(syncNow, 800)
    const interval = window.setInterval(syncNow, AUTO_SYNC_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(wakeTimer)
      window.clearTimeout(initialTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
    }
  }, [autoSync, booted, user])

  // Follow Codex's active provider even when quota data is not due for a sync.
  useEffect(() => {
    if (!booted || !user) return
    void refreshCodexCurrent()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCodexCurrent()
    }, 30_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshCodexCurrent()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [booted, refreshCodexCurrent, user])

  const handleLoginProvider = useCallback(
    async (provider: Provider) => {
      if (!provider.sourceId || !provider.loginProvider) {
        notify('该供应商不支持网页登录额度')
        return
      }
      if (
        login &&
        (login.status === 'starting' || login.status === 'waiting')
      ) {
        return
      }

      setLogin({
        sourceId: provider.sourceId,
        providerName: loginBrand(provider),
        status: 'starting',
      })
      try {
        const response = await fetch('/api/cc-switch/login/start', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sourceId: provider.sourceId }),
        })
        const payload = (await response.json().catch(() => ({}))) as {
          status?: string
          message?: string
          error?: string
        }
        if (!response.ok) {
          throw new Error(
            payload.message || payload.error || '无法打开登录窗口',
          )
        }
        if (payload.status === 'authenticated') {
          setLogin(null)
          notify('Krill 登录态已就绪，正在同步额度')
          void handleRefresh()
          return
        }
        setLogin((current) =>
          current
            ? {
                ...current,
                status: 'waiting',
                message: '等待完成 Google 登录…',
              }
            : null,
        )
      } catch (error) {
        setLogin((current) =>
          current
            ? {
                ...current,
                status: 'error',
                message: readableSyncError(error),
              }
            : null,
        )
      }
    },
    [handleRefresh, login, notify],
  )

  const handleLoginRetry = useCallback(() => {
    if (!login) return
    const provider = providers.find(
      (item) => item.sourceId === login.sourceId,
    )
    if (!provider) {
      setLogin(null)
      return
    }
    void handleLoginProvider(provider)
  }, [handleLoginProvider, login, providers])

  useEffect(() => {
    if (!login || login.status !== 'waiting') return
    let cancelled = false
    let timer: number | undefined
    const startedAt = Date.now()

    const poll = async () => {
      if (cancelled) return
      if (Date.now() - startedAt > 10 * 60_000) {
        setLogin((current) =>
          current && current.status === 'waiting'
            ? {
                ...current,
                status: 'error',
                message: '登录等待超时，请重新打开登录窗口',
              }
            : current,
        )
        return
      }
      try {
        const response = await fetch(
          `/api/cc-switch/login/status?sourceId=${encodeURIComponent(login.sourceId)}`,
          { cache: 'no-store' },
        )
        const payload = (await response.json().catch(() => ({}))) as {
          status?: string
          message?: string
        }
        if (cancelled) return
        if (payload.status === 'authenticated') {
          setLogin(null)
          notify('Krill 登录成功，正在同步额度')
          void handleRefresh()
          return
        }
        if (payload.status === 'error') {
          setLogin((current) =>
            current && current.status === 'waiting'
              ? {
                  ...current,
                  status: 'error',
                  message: payload.message || '登录窗口已关闭，请重试',
                }
              : current,
          )
          return
        }
        timer = window.setTimeout(poll, 1600)
      } catch {
        if (!cancelled) {
          setLogin((current) =>
            current && current.status === 'waiting'
              ? {
                  ...current,
                  status: 'error',
                  message: '无法连接本地登录服务',
                }
              : current,
          )
        }
      }
    }

    timer = window.setTimeout(poll, 1200)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [login?.sourceId, login?.status, handleRefresh, notify])

  const loginBusyId =
    login && (login.status === 'starting' || login.status === 'waiting')
      ? login.sourceId
      : undefined

  const codexProvider = useMemo(
    () => findCodexProvider(providers, codexCurrent),
    [codexCurrent, providers],
  )
  const codexProviderId = codexProvider?.id

  if (!user) {
    return <LoginPage onSignIn={handleSignIn} accountCount={accounts.length} />
  }

  if (!booted) {
    return <BootScreen message={bootMessage} />
  }

  return (
    <div className="app-shell">
      <TopBar
        syncing={syncing}
        importing={importing}
        autoSync={autoSync}
        lastSyncedAt={lastSyncedAt}
        alerts={alerts}
        user={user}
        storageMode={storageMode}
        onPushLocal={handlePushLocal}
        onRefresh={handleRefresh}
        onToggleAutoSync={() => setAutoSync((current) => !current)}
        onImport={handleImport}
        onSelectProvider={(id) => {
          const provider = providers.find((item) => item.id === id)
          if (provider) openEdit(provider)
        }}
        onExport={handleExport}
        onOpenLogs={() => setLogsOpen(true)}
        onReset={handleReset}
        onManageAccounts={() => setAccountsOpen(true)}
        onLogout={handleLogout}
      />

      <div className="app-body">
        <Sidebar
          page={page}
          providerCount={providers.length}
          onNavigate={navigate}
        />
        <main className="main" ref={mainRef}>
          {page === 'overview' && (
            <Overview
              providers={providers}
              lastSyncedAt={lastSyncedAt}
              onEdit={openEdit}
              onAdd={openAdd}
              onNavigate={navigate}
              onLogin={handleLoginProvider}
              loginBusyId={loginBusyId}
              codexProviderId={codexProviderId}
            />
          )}
          {page === 'providers' && (
            <ProvidersPage
              providers={providers}
              importing={importing}
              onAdd={openAdd}
              onAddPreset={(preset) => openAdd('image', preset)}
              onImport={handleImport}
              onEdit={openEdit}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onLogin={handleLoginProvider}
              loginBusyId={loginBusyId}
              codexProviderId={codexProviderId}
            />
          )}
          {page === 'usage' && (
            <UsagePage
              providers={providers}
              onEdit={openEdit}
              onNavigate={navigate}
              codexProviderId={codexProviderId}
            />
          )}
        </main>
      </div>

      <ProviderDrawer
        open={drawerOpen}
        provider={editing}
        initialType={initialType}
        preset={drawerPreset}
        onClose={closeDrawer}
        onSave={handleSave}
        onLogin={handleLoginProvider}
        loginBusy={
          Boolean(loginBusyId && editing?.sourceId === loginBusyId)
        }
      />

      <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />

      <SyncLogDialog open={logsOpen} onClose={() => setLogsOpen(false)} />

      <AccountManager
        open={accountsOpen}
        accounts={accounts}
        onClose={() => setAccountsOpen(false)}
        onCreate={handleCreateAccount}
        onDelete={handleDeleteAccount}
      />

      <LoginDialog
        state={login}
        onCancel={() => setLogin(null)}
        onRetry={handleLoginRetry}
      />

      <Toast
        key={toast?.id}
        message={toast?.message ?? null}
        tone={toast?.tone}
        onDismiss={dismissToast}
      />
    </div>
  )
}
