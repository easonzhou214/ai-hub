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
  changePassword,
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
  applySyncFailure,
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
import { useHubState } from './hubState'
import { Overview } from './pages/Overview'
import { ProvidersPage } from './pages/Providers'
import { UsagePage } from './pages/Usage'
import { bridgeReachable, syncRunnerPhrase, useRuntimeInfo } from './runtime'
import { reportSyncFailure } from './syncLog'
import type {
  PageKey,
  Provider,
  ProviderDraft,
  ProviderPreset,
  ProviderType,
} from './types'
import {
  isInterfaceSynced,
  loginBrand,
  providerAlerts,
} from './utils'

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000
/** 自动同步的最短重试间隔（失败后不写时间戳，靠它节流）。 */
const AUTO_SYNC_COOLDOWN_MS = 60_000
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

async function syncImportedProviders(providers: Provider[]) {
  let syncedCount = 0
  const synced = await Promise.all(
    providers.map(async (provider) => {
      try {
        const snapshot = await fetchProviderBilling(provider)
        // 登录态过期时接口仍返回 200，但没读到任何额度，不能算同步成功。
        if (!snapshot.loginRequired) syncedCount += 1
        return applyBillingSnapshot(provider, snapshot)
      } catch (error) {
        return applySyncFailure(provider, error)
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
  // 只存 id：编辑期间同步会更新 providers，抽屉必须看到最新的那一份，
  // 否则保存时会把刚同步到的额度写回旧值。
  const [editingId, setEditingId] = useState<string | null>(null)
  const [initialType, setInitialType] = useState<ProviderType>('coding')
  const [syncing, setSyncing] = useState(false)
  const [login, setLogin] = useState<LoginUiState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [toast, setToast] = useState<{
    id: number
    message: string
    tone: 'success' | 'error' | 'info'
  } | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const syncingRef = useRef(false)
  // 自动同步的节流用：失败不会更新 lastSyncedAt（顶栏的「上次同步」不能撒谎），
  // 所以要单独记住最后一次尝试的时间，避免每次切回标签页都重跑一轮。
  const lastAttemptRef = useRef(0)

  const { runtime, checked: runtimeChecked } = useRuntimeInfo()

  const notify = useCallback(
    (
      message: string,
      tone: 'success' | 'error' | 'info' = 'success',
    ) => {
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

  const handleChangePassword = useCallback(
    (current: string, next: string) => {
      if (!user) return '请先登录'
      const message = changePassword(user.id, current, next)
      if (message) return message
      setAccounts(getAccounts())
      requestHubSave()
      notify('密码已更新')
      return null
    },
    [notify, requestHubSave, user],
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
        // 先进界面，额度交给自动同步在后台补齐：Krill / Aixor 首次读取要拉起
        // headless Chrome，多个供应商串行下来可能要几十秒，没必要把启动页堵住。
        setProviders(imported)
        setBooted(true)
        notify(
          `已从 CC Switch 接入 ${imported.length} 个供应商，正在同步额度…`,
        )
      } catch (error) {
        if (cancelled) return
        // 读不到 CC Switch 时保持空态：以前这里会塞进 8 个假的供应商和
        // 假额度，看起来像真实数据，反而误导判断。
        setBooted(true)
        notify(`未读取到 CC Switch 配置：${readableSyncError(error)}`, 'error')
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
        if (result.syncedCount > 0) {
          setLastSyncedAt(new Date().toISOString())
        }
        notify(
          result.syncedCount > 0
            ? `已从 CC Switch 同步 ${result.providers.length} 个新供应商`
            : `已导入 ${result.providers.length} 个新供应商，额度待补录`,
          result.syncedCount > 0 ? 'success' : 'info',
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

  // CC Switch 接口默认只接受回环请求。在别的设备上打开页面时，同步 / 导入 /
  // 网页登录都必然 403：提前置灰并说清原因，比让用户等一轮超时看到红字好。
  const bridgeBlocked = runtimeChecked && !bridgeReachable(runtime)
  const bridgeBlockedReason = !runtime
    ? '这个地址没有本地服务（纯静态部署），读不到 CC Switch 和登录态'
    : `同步由运行服务的机器执行：请在 ${runtime.hostname} 上打开页面，或用 AIHUB_ALLOW_REMOTE_SYNC=1 重启服务`
  const bridgeTargetCount = providers.filter(
    (provider) =>
      provider.enabled &&
      isInterfaceSynced(provider) &&
      provider.syncMode !== 'pixellab',
  ).length
  const pixellabTargetCount = providers.filter(
    (provider) => provider.enabled && provider.syncMode === 'pixellab',
  ).length
  // 有 CC Switch 供应商、又没有能直连的 PixelLab 时，同步按钮直接不可用。
  const syncBlockedReason =
    bridgeBlocked && bridgeTargetCount > 0 && pixellabTargetCount === 0
      ? bridgeBlockedReason
      : null

  const openAdd = useCallback(
    (type?: ProviderType, preset?: ProviderPreset) => {
      setEditingId(null)
      setInitialType(type ?? (preset === 'pixellab' ? 'image' : 'coding'))
      setDrawerPreset(preset ?? null)
      setDrawerOpen(true)
    },
    [],
  )

  const openEdit = useCallback((provider: Provider) => {
    setEditingId(provider.id)
    setInitialType(provider.type)
    setDrawerPreset(null)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setDrawerPreset(null)
    setEditingId(null)
  }, [])

  const editing = useMemo(
    () => providers.find((provider) => provider.id === editingId) ?? null,
    [editingId, providers],
  )

  // 正在编辑的供应商被删掉（本机或另一台设备）时收起抽屉。
  useEffect(() => {
    if (editingId && !editing) {
      setDrawerOpen(false)
      setEditingId(null)
    }
  }, [editing, editingId])

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
      setEditingId(null)
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
                  ? applySyncFailure(provider, error)
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
          if (editingId === provider.id) {
            setDrawerOpen(false)
            setEditingId(null)
          }
          notify(`已删除 ${provider.name}`)
        },
      })
    },
    [editingId, notify, setProviders],
  )

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
      // 导入只保证「配置对齐」，额度可能一个都没读到，别把时间戳改新。
      if (result.syncedCount > 0) setLastSyncedAt(new Date().toISOString())
      notify(
        result.syncedCount > 0
          ? `已从 CC Switch 导入 ${result.providers.length} 个供应商并同步额度`
          : `已导入 ${result.providers.length} 个供应商，但额度没读到，卡片里会显示原因`,
        result.syncedCount > 0 ? 'success' : 'error',
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
        if (!silent) notify('没有启用的供应商可同步', 'info')
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!silent) notify('网络已断开，恢复网络后会自动重试', 'error')
        return
      }
      if (syncBlockedReason) {
        if (!silent) notify(syncBlockedReason, 'error')
        return
      }

      syncingRef.current = true
      lastAttemptRef.current = Date.now()
      setSyncing(true)
      try {
        let realSynced = 0
        let bridgeSkipped = 0
        const needLogin: string[] = []
        const failures: Array<{ name: string; message: string }> = []
        const now = new Date().toISOString()
        // 记下开始时的版本号：只有同步期间没被用户改过的供应商才允许覆盖，
        // 否则整体 setProviders(updated) 会吞掉这期间的开关/编辑操作。
        const baseVersions = new Map(
          providers.map((provider) => [provider.id, provider.updatedAt]),
        )
        const updated = await Promise.all(
          providers.map(async (provider) => {
            if (!provider.enabled) return provider
            if (!isInterfaceSynced(provider)) return provider
            // 客户端访问时 CC Switch 接口会 403，跳过而不是记一条失败。
            if (provider.syncMode !== 'pixellab' && bridgeBlocked) {
              bridgeSkipped += 1
              return provider
            }
            const startedAt = Date.now()
            try {
              const snapshot = await fetchProviderBilling(provider)
              // 200 但 loginRequired 只说明登录态过期，不是「同步成功」。
              // 早先把这种情况算进成功数，才会出现提示成功、数字没动。
              if (snapshot.loginRequired) {
                needLogin.push(provider.name)
              } else {
                realSynced += 1
              }
              return applyBillingSnapshot(provider, snapshot)
            } catch (error) {
              const message = readableSyncError(error)
              const raw =
                error instanceof Error ? error.message : String(error ?? '')
              if (provider.syncMode === 'pixellab' || /无法连接本地/.test(raw)) {
                reportSyncFailure(provider, error, Date.now() - startedAt)
              }
              failures.push({ name: provider.name, message })
              return applySyncFailure(provider, error)
            }
          }),
        )
        const syncedById = new Map(updated.map((provider) => [provider.id, provider]))
        setProviders((current) =>
          current.map((provider) => {
            const next = syncedById.get(provider.id)
            if (!next) return provider
            const base = baseVersions.get(provider.id)
            if (base !== provider.updatedAt) return provider
            return next
          }),
        )
        // 只有真读到额度才更新时间戳：全部失败时顶栏还显示「上次同步 刚刚」，
        // 正是「提示成功、其实没同步」的来源。
        if (realSynced > 0) setLastSyncedAt(now)
        void refreshCodexCurrent()

        if (!silent) {
          const skippedNote =
            bridgeSkipped > 0
              ? `（${bridgeSkipped} 个 CC Switch 供应商需在运行服务的机器上同步）`
              : ''
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
          } else if (needLogin.length > 0) {
            const where =
              runtime?.role === 'client'
                ? `在服务器 ${runtime.hostname} 上`
                : ''
            notify(
              `${needLogin.join('、')} 的登录态已过期，请${where}重新登录后再同步`,
              'error',
            )
          } else if (realSynced > 0) {
            notify(
              `${syncRunnerPhrase(runtime)}同步 ${realSynced} 个供应商的最新额度${skippedNote}`,
              skippedNote ? 'info' : 'success',
            )
          } else if (bridgeSkipped > 0) {
            notify(bridgeBlockedReason, 'error')
          } else {
            notify('没有可自动同步的接口供应商，手动录入的额度不受影响', 'info')
          }
        }
      } finally {
        syncingRef.current = false
        setSyncing(false)
      }
    },
    [
      bridgeBlocked,
      bridgeBlockedReason,
      notify,
      providers,
      refreshCodexCurrent,
      runtime,
      setLastSyncedAt,
      setProviders,
      syncBlockedReason,
    ],
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
    const needsSync = () => {
      // 失败不再写 lastSyncedAt（顶栏不能显示假的「上次同步」），所以这里用
      // 「最后一次尝试」兜底，避免每次切回标签页都重跑一轮注定失败的同步。
      if (Date.now() - lastAttemptRef.current < AUTO_SYNC_COOLDOWN_MS) {
        return false
      }
      return (
        isStale() ||
        providersRef.current.some(
          (provider) => provider.enabled && provider.syncError,
        )
      )
    }

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
      // 网页登录要在这台机器上拉起 headless Chrome，客户端调不通。
      if (bridgeBlocked) {
        notify(bridgeBlockedReason, 'error')
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
        syncRunner={syncRunnerPhrase(runtime)}
        isRemoteClient={runtime?.role === 'client'}
        syncBlockedReason={syncBlockedReason}
        bridgeAvailable={!bridgeBlocked}
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
        onManageAccounts={() => setAccountsOpen(true)}
        onLogout={handleLogout}
      />

      <div className="app-body">
        <Sidebar
          page={page}
          providerCount={providers.length}
          storageLabel={
            storageMode === 'server'
              ? '服务端存储 · 多端共用'
              : '本机存储 · 未连接服务端'
          }
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
              importBlockedReason={bridgeBlocked ? bridgeBlockedReason : null}
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
        escapeDisabled={Boolean(login)}
      />

      <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />

      <SyncLogDialog open={logsOpen} onClose={() => setLogsOpen(false)} />

      <AccountManager
        open={accountsOpen}
        accounts={accounts}
        currentUser={user}
        onClose={() => setAccountsOpen(false)}
        onCreate={handleCreateAccount}
        onDelete={handleDeleteAccount}
        onChangePassword={handleChangePassword}
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
