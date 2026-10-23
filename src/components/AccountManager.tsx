import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Account, AccountInput } from '../auth'
import { Icon } from '../icons'
import { cx } from '../utils'
import { ConfirmDialog, type ConfirmState } from './Overlays'

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day}`
}

function initialOf(account: Account) {
  return (
    account.displayName.trim().charAt(0).toUpperCase() ||
    account.username.charAt(0).toUpperCase()
  )
}

export function AccountManager({
  open,
  accounts,
  onClose,
  onCreate,
  onDelete,
}: {
  open: boolean
  accounts: Account[]
  onClose: () => void
  /** 返回 null 表示创建成功，否则返回错误文案。 */
  onCreate: (input: AccountInput) => string | null
  onDelete: (account: Account) => void
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => usernameRef.current?.focus(), 80)
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirm) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose, confirm])

  useEffect(() => {
    if (open) return
    setUsername('')
    setDisplayName('')
    setPassword('')
    setReveal(false)
    setError(null)
    setConfirm(null)
  }, [open])

  if (!open) return null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = onCreate({ username, password, displayName })
    if (message) {
      setError(message)
      return
    }
    setError(null)
    setUsername('')
    setDisplayName('')
    setPassword('')
    setReveal(false)
    usernameRef.current?.focus()
  }

  const askDelete = (account: Account) => {
    setConfirm({
      title: `删除账号 ${account.username}？`,
      description:
        '该账号将无法再登录 AI Hub，供应商配置与同步记录不受影响。操作无法撤销。',
      confirmLabel: '删除账号',
      tone: 'danger',
      onConfirm: () => onDelete(account),
    })
  }

  const adminCount = accounts.filter((account) => account.role === 'admin').length
  const memberCount = accounts.length - adminCount

  return (
    <>
      <div className="modal-layer accounts-layer" role="presentation">
        <div className="modal-backdrop" onClick={onClose} />
        <div
          className="accounts-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accounts-title"
        >
          <div className="accounts-head">
            <span className="accounts-icon">
              <Icon name="users" size={18} />
            </span>
            <div className="accounts-heading">
              <p className="login-eyebrow">管理员</p>
              <h2 id="accounts-title">账号管理</h2>
              <p>
                管理可登录本工作区的账号 · 管理员 {adminCount} 个 · 普通账号{' '}
                {memberCount} 个
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭账号管理"
              onClick={onClose}
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="accounts-body">
            <ul className="accounts-list">
              {accounts.map((account) => (
                <li key={account.id} className="accounts-row">
                  <span
                    className={cx(
                      'accounts-avatar',
                      account.role === 'admin' && 'is-admin',
                    )}
                  >
                    {initialOf(account)}
                  </span>
                  <div className="accounts-copy">
                    <strong>
                      {account.displayName}
                      <span
                        className={cx(
                          'role-chip',
                          account.role === 'admin' && 'is-admin',
                        )}
                      >
                        {account.role === 'admin' ? '管理员' : '普通'}
                      </span>
                    </strong>
                    <span>
                      @{account.username} · 创建于 {formatDate(account.createdAt)}
                    </span>
                  </div>
                  {account.role === 'admin' ? (
                    <span className="accounts-locked">
                      <Icon name="lock" size={12} />
                      不可删除
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="accounts-delete"
                      aria-label={`删除账号 ${account.username}`}
                      title="删除账号"
                      onClick={() => askDelete(account)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <form className="accounts-add" onSubmit={submit}>
              <div className="accounts-add-title">
                <Icon name="plus" size={13} />
                添加普通账号
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor="new-account-username">
                    用户名
                  </label>
                  <input
                    id="new-account-username"
                    ref={usernameRef}
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value)
                      setError(null)
                    }}
                    placeholder="3–20 位字母或数字"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="new-account-name">
                    显示名称
                    <span className="field-optional">可选</span>
                  </label>
                  <input
                    id="new-account-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="默认与用户名相同"
                    autoComplete="off"
                  />
                </div>
                <div className="field full">
                  <label className="field-label" htmlFor="new-account-password">
                    密码
                  </label>
                  <div className="input-with-action">
                    <input
                      id="new-account-password"
                      type={reveal ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setError(null)
                      }}
                      placeholder="至少 6 位"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="input-action"
                      aria-label={reveal ? '隐藏密码' : '显示密码'}
                      onClick={() => setReveal((current) => !current)}
                    >
                      <Icon name={reveal ? 'eye-off' : 'eye'} size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <p className="auth-error" role="alert">
                  <Icon name="alert" size={13} />
                  {error}
                </p>
              )}

              <div className="accounts-add-foot">
                <span className="field-hint">
                  普通账号只能查看与同步供应商，不能管理其他账号。
                </span>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!username.trim() || !password}
                >
                  <Icon name="plus" size={13} />
                  添加账号
                </button>
              </div>
            </form>
          </div>

          <div className="accounts-foot">
            <span className="login-foot-note">
              <Icon name="lock" size={12} />
              账号与会话仅保存在此浏览器
            </span>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />
    </>
  )
}
