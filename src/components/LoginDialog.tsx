import { useEscapeKey } from '../hooks'
import { Icon } from '../icons'
import { cx } from '../utils'

export interface LoginUiState {
  sourceId: string
  providerName: string
  status: 'starting' | 'waiting' | 'error'
  message?: string
}

export function LoginDialog({
  state,
  onCancel,
  onRetry,
}: {
  state: LoginUiState | null
  onCancel: () => void
  onRetry: () => void
}) {
  useEscapeKey(Boolean(state), onCancel)

  if (!state) return null

  const waiting = state.status === 'starting' || state.status === 'waiting'

  return (
    <div className="modal-layer login-layer" role="presentation">
      <div className="modal-backdrop" onClick={onCancel} />
      <div
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
        aria-live="polite"
      >
        <div className="login-dialog-head">
          <span className={cx('login-dialog-icon', state.status === 'error' && 'is-error')}>
            <Icon name={state.status === 'error' ? 'alert' : 'key'} size={18} />
          </span>
          <div>
            <p className="login-eyebrow">网页登录态</p>
            <h2 id="login-dialog-title">登录 {state.providerName}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭登录窗口提示"
            onClick={onCancel}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="login-dialog-body">
          {state.status === 'starting' ? (
            <>
              <span className="login-spinner" />
              <p className="login-status-text">正在打开独立的 Chrome 登录窗口…</p>
            </>
          ) : state.status === 'waiting' ? (
            <>
              <span className="login-spinner" />
              <div className="login-instructions">
                <p className="login-status-text">
                  请在刚打开的 Chrome 窗口中完成登录。
                </p>
                <p>
                  登录成功后会自动读取额度并关闭这个提示。AI Hub
                  不会保存你的登录密码，登录窗口使用独立的浏览器配置。
                </p>
              </div>
            </>
          ) : (
            <div className="login-error">
              <p className="login-status-text">
                {state.message || '登录没有完成，请重试。'}
              </p>
              <p>
                如果登录窗口被关闭，可以点击下方重试重新打开。浏览器里仍然保留
                Krill / Google 的登录会话。
              </p>
            </div>
          )}
        </div>

        <div className="login-dialog-foot">
          <span className="login-foot-note">
            <Icon name="lock" size={12} />
            登录态只保存在本机
          </span>
          <div className="login-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {waiting ? '稍后再说' : '取消'}
            </button>
            {state.status === 'error' && (
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                <Icon name="refresh" size={13} />
                重新打开登录窗口
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
