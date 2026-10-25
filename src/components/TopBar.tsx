import { useEffect, useRef, useState } from 'react'
import type { Account } from '../auth'
import { Icon } from '../icons'
import type { AlertItem } from '../types'
import { cx, initialOf, relativeTime } from '../utils'
import { BrandMark, Switch } from './ui'

type PopoverKey = 'notifications' | 'account' | null

interface TopBarProps {
  syncing: boolean
  autoSync: boolean
  lastSyncedAt: string
  alerts: AlertItem[]
  importing: boolean
  user: Account
  storageMode: 'server' | 'local'
  /** 同步在哪台机器上执行，形如「在本机」「在服务器 xxx 上」。 */
  syncRunner: string
  /** 是不是从别的设备打开（同步由服务器代劳）。 */
  isRemoteClient: boolean
  /** 这台设备读不到 CC Switch 时，置灰同步按钮的原因。 */
  syncBlockedReason: string | null
  /** CC Switch 相关动作（导入 / 网页登录）在这台设备上是否可用。 */
  bridgeAvailable: boolean
  onPushLocal: () => void
  onRefresh: () => void
  onToggleAutoSync: () => void
  onImport: () => void
  onSelectProvider: (id: string) => void
  onExport: () => void
  onOpenLogs: () => void
  onManageAccounts: () => void
  onLogout: () => void
}

export function TopBar({
  syncing,
  autoSync,
  lastSyncedAt,
  alerts,
  importing,
  user,
  storageMode,
  syncRunner,
  isRemoteClient,
  syncBlockedReason,
  bridgeAvailable,
  onPushLocal,
  onRefresh,
  onToggleAutoSync,
  onImport,
  onSelectProvider,
  onExport,
  onOpenLogs,
  onManageAccounts,
  onLogout,
}: TopBarProps) {
  const [open, setOpen] = useState<PopoverKey>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [, setClock] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setClock((tick) => tick + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setOpen(null)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const toggle = (key: Exclude<PopoverKey, null>) =>
    setOpen((current) => (current === key ? null : key))

  const isAdmin = user.role === 'admin'
  const initial = initialOf(user.displayName, user.username, 'E')

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <BrandMark />
        <span className="brand-name">AI Hub</span>
      </div>

      <div className="topbar-right" ref={actionsRef}>
        <div className="auto-sync" title="开启后每 5 分钟自动同步一次">
          <span className="auto-sync-label">自动同步</span>
          <Switch
            checked={autoSync}
            onChange={onToggleAutoSync}
            label="自动同步供应商额度"
          />
          <span className="auto-sync-time">
            上次同步 {relativeTime(lastSyncedAt)}
          </span>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm sync-button"
          onClick={onRefresh}
          disabled={syncing || Boolean(syncBlockedReason)}
          aria-label="同步供应商额度"
          title={
            syncBlockedReason ??
            `${syncRunner}执行 · 上次同步 ${relativeTime(lastSyncedAt)}`
          }
        >
          <Icon
            name="refresh"
            size={14}
            className={cx('sync-icon', syncing && 'spinning')}
          />
          {syncing ? '同步中…' : '同步额度'}
        </button>

        <span className="topbar-divider" />

        <div className="popover-anchor">
          <button
            type="button"
            className={cx('icon-button', open === 'notifications' && 'is-open')}
            aria-label={`通知${alerts.length ? `，${alerts.length} 条待关注` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open === 'notifications'}
            onClick={() => toggle('notifications')}
          >
            <Icon name="bell" size={17} />
            {alerts.length > 0 && (
              <span className="notification-dot">{alerts.length}</span>
            )}
          </button>
          {open === 'notifications' && (
            <div className="popover notification-popover" role="dialog" aria-label="通知">
              <div className="popover-head">
                <div>
                  <h3>通知</h3>
                  <p>根据额度与到期时间自动生成</p>
                </div>
                {alerts.length > 0 && (
                  <span className="count-pill">{alerts.length}</span>
                )}
              </div>
              {alerts.length === 0 ? (
                <div className="popover-empty">
                  <span className="popover-empty-icon">
                    <Icon name="check-circle" size={18} />
                  </span>
                  <p>暂无需要关注的额度</p>
                  <span>一切都在正常范围内</span>
                </div>
              ) : (
                <div className="notification-list">
                  {alerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      className="notification-item"
                      onClick={() => {
                        setOpen(null)
                        onSelectProvider(alert.providerId)
                      }}
                    >
                      <span className={cx('notification-icon', alert.tone)}>
                        <Icon
                          name={alert.tone === 'expire' ? 'calendar' : 'alert'}
                          size={14}
                        />
                      </span>
                      <span className="notification-copy">
                        <strong>{alert.title}</strong>
                        <span>{alert.description}</span>
                      </span>
                      <Icon
                        name="chevron-right"
                        size={14}
                        className="notification-arrow"
                      />
                    </button>
                  ))}
                </div>
              )}
              <div className="popover-foot">
                <Icon name="lock" size={12} />
                数据来自本地配置，可手动同步
              </div>
            </div>
          )}
        </div>

        <div className="popover-anchor">
          <button
            type="button"
            className={cx('avatar-button', open === 'account' && 'is-open')}
            aria-label={`账户与设置（${user.displayName}）`}
            aria-haspopup="dialog"
            aria-expanded={open === 'account'}
            onClick={() => toggle('account')}
          >
            <span className="avatar">{initial}</span>
            <span className="avatar-presence" />
          </button>
          {open === 'account' && (
            <div className="popover account-popover" role="dialog" aria-label="账户">
              <div className="account-head">
                <span className="avatar avatar-lg">{initial}</span>
                <div>
                  <strong>{user.displayName} 的个人工作区</strong>
                  <span>
                    {isAdmin
                      ? '管理员 · 全部权限'
                      : `@${user.username} · 普通账号`}
                    {' · '}
                    {isRemoteClient ? '客户端（同步在服务器）' : '本机'}
                  </span>
                </div>
              </div>
              <div className="popover-separator" />
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(null)
                  onImport()
                }}
                disabled={!bridgeAvailable}
                title={
                  bridgeAvailable
                    ? undefined
                    : 'CC Switch 只存在运行服务的那台机器上，这台设备读不到'
                }
              >
                <Icon
                  name="refresh"
                  size={15}
                  className={importing ? 'spinning' : undefined}
                />
                {importing ? '正在导入…' : '从 CC Switch 导入'}
                <span className="menu-hint">
                  {bridgeAvailable ? '本机数据' : '仅服务器'}
                </span>
              </button>
              {storageMode === 'server' && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpen(null)
                    onPushLocal()
                  }}
                >
                  <Icon name="server" size={15} />
                  用本机配置覆盖服务端
                  <span className="menu-hint">同步</span>
                </button>
              )}
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(null)
                  onExport()
                }}
              >
                <Icon name="download" size={15} />
                导出供应商配置
                <span className="menu-hint">不含 Key</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(null)
                  onOpenLogs()
                }}
              >
                <Icon name="info" size={15} />
                同步日志
                <span className="menu-hint">诊断</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpen(null)
                    onManageAccounts()
                  }}
                >
                  <Icon name="users" size={15} />
                  账号管理
                  <span className="menu-hint">管理员</span>
                </button>
              )}
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(null)
                  onLogout()
                }}
              >
                <Icon name="logout" size={15} />
                退出登录
                <span className="menu-hint">@{user.username}</span>
              </button>
              <div className="popover-foot">
                {`AI Hub v${__APP_VERSION__} · ${
                  storageMode === 'server'
                    ? '数据保存在服务端，多设备共享'
                    : '数据仅保存在此浏览器'
                }`}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
