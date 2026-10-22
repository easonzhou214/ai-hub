import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { fetchSyncLogs, type SyncLogEvent, type SyncLogSnapshot } from '../syncLog'
import { cx } from '../utils'

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const time = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

function formatDuration(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  if (value < 1_000) return `${Math.max(1, Math.round(value))}ms`
  return `${(value / 1_000).toFixed(1)}s`
}

function SyncLogRow({ event }: { event: SyncLogEvent }) {
  const duration = formatDuration(event.durationMs)
  return (
    <li className={cx('sync-log-row', `is-${event.level}`)}>
      <span className="sync-log-time">{formatTimestamp(event.ts)}</span>
      <span className="sync-log-dot" aria-hidden="true" />
      <span className="sync-log-main">
        <span className="sync-log-title">
          <strong>{event.provider ?? event.sourceId ?? '本地服务'}</strong>
          <span className="sync-log-message">{event.message}</span>
        </span>
        <span className="sync-log-meta">
          <span>{event.layer === 'client' ? '浏览器' : '本地服务'}</span>
          {duration && <span>{duration}</span>}
          {event.attempt && event.attempt > 1 && (
            <span>第 {event.attempt} 次尝试</span>
          )}
          {event.code && <span className="sync-log-code">{event.code}</span>}
        </span>
      </span>
    </li>
  )
}

export function SyncLogDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState<SyncLogSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchSyncLogs(120)
      .then((next) => {
        if (cancelled) return
        setSnapshot(next)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(
          reason instanceof Error ? reason.message : '无法读取同步日志',
        )
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, reloadKey])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const events = snapshot?.events ?? []
  const failed = events.filter((event) => event.level === 'error').length

  return (
    <div className="modal-layer logs-layer" role="presentation">
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className="sync-log-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-log-title"
      >
        <div className="sync-log-head">
          <span className="sync-log-icon">
            <Icon name="info" size={18} />
          </span>
          <div className="sync-log-heading">
            <h2 id="sync-log-title">同步日志</h2>
            <p>
              {events.length > 0
                ? `最近 ${events.length} 条记录 · ${failed} 条失败`
                : '每次额度同步的结果与失败原因'}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭同步日志"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {snapshot?.path && (
          <div className="sync-log-path">
            <Icon name="lock" size={12} />
            <code>{snapshot.path}</code>
          </div>
        )}

        <div className="sync-log-body">
          {loading && events.length === 0 ? (
            <div className="sync-log-empty">
              <span className="sync-log-empty-icon">
                <Icon name="refresh" size={17} className="spinning" />
              </span>
              <p>正在读取日志…</p>
            </div>
          ) : error ? (
            <div className="sync-log-empty is-error">
              <span className="sync-log-empty-icon">
                <Icon name="alert" size={17} />
              </span>
              <p>读取日志失败</p>
              <span>{error}</span>
            </div>
          ) : events.length === 0 ? (
            <div className="sync-log-empty">
              <span className="sync-log-empty-icon">
                <Icon name="check-circle" size={18} />
              </span>
              <p>还没有同步记录</p>
              <span>点击顶部的「同步额度」，这里会记录每一次请求的结果。</span>
            </div>
          ) : (
            <ul className="sync-log-list">
              {events.map((event, index) => (
                <SyncLogRow
                  key={`${event.ts}-${event.provider ?? ''}-${index}`}
                  event={event}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="sync-log-foot">
          <span>
            <Icon name="lock" size={12} />
            保留最近 30 天，仅存本机
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setReloadKey((current) => current + 1)}
            disabled={loading}
          >
            <Icon
              name="refresh"
              size={13}
              className={cx('sync-icon', loading && 'spinning')}
            />
            刷新
          </button>
        </div>
      </div>
    </div>
  )
}
