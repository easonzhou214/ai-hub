import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import { cx } from '../utils'
import { BrandMark } from './ui'

export function LoginPage({
  onSignIn,
  accountCount,
}: {
  /** 返回 null 表示登录成功，否则返回错误文案。 */
  onSignIn: (username: string, password: string) => string | null
  accountCount: number
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = onSignIn(username, password)
    if (message) {
      setError(message)
      passwordRef.current?.focus()
      passwordRef.current?.select()
      return
    }
    setError(null)
  }

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark size={30} />
          <span className="brand-name">AI Hub</span>
        </div>

        <form className="auth-form" onSubmit={submit} noValidate>
          <div className={cx('field', error && !username.trim() && 'has-error')}>
            <label className="field-label" htmlFor="auth-username">
              用户名
            </label>
            <input
              id="auth-username"
              ref={usernameRef}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setError(null)
              }}
              placeholder="请输入用户名"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </div>

          <div className={cx('field', error && 'has-error')}>
            <label className="field-label" htmlFor="auth-password">
              密码
            </label>
            <div className="input-with-action">
              <input
                id="auth-password"
                ref={passwordRef}
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError(null)
                }}
                placeholder="输入密码"
                autoComplete="current-password"
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

          {error && (
            <p className="auth-error" role="alert">
              <Icon name="alert" size={13} />
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={!username.trim() || !password}
          >
            登录
            <Icon name="arrow-right" size={14} />
          </button>
        </form>

        <div className="auth-foot">
          <span>
            <Icon name="lock" size={12} />
            密码经摘要后存于本机
          </span>
          <span className="auth-foot-sep" aria-hidden="true">
            ·
          </span>
          <span>
            {accountCount > 0 ? `本机 ${accountCount} 个账号` : '本机暂无账号'}
          </span>
        </div>
        <p className="auth-hint">
          普通账号由管理员在「个人信息 → 账号管理」中创建。
        </p>
      </div>
    </div>
  )
}
