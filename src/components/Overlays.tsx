import { useEffect, useRef } from 'react'
import { useEscapeKey, useInitialFocus } from '../hooks'
import { Icon } from '../icons'
import { cx } from '../utils'

export interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  tone?: 'danger' | 'neutral'
  onConfirm: () => void
}

interface ConfirmDialogProps {
  state: ConfirmState | null
  onCancel: () => void
}

export function ConfirmDialog({ state, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEscapeKey(Boolean(state), onCancel)
  useInitialFocus(Boolean(state), cancelRef)

  if (!state) return null

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-backdrop" onClick={onCancel} />
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
      >
        <span
          className={cx(
            'confirm-icon',
            state.tone === 'neutral' && 'is-neutral',
          )}
        >
          <Icon name={state.tone === 'neutral' ? 'rotate' : 'alert'} size={18} />
        </span>
        <h2 id="confirm-title">{state.title}</h2>
        <p id="confirm-desc">{state.description}</p>
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className={cx(
              'btn',
              state.tone === 'neutral' ? 'btn-primary' : 'btn-danger',
            )}
            onClick={() => {
              state.onConfirm()
              onCancel()
            }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toast({
  message,
  tone = 'success',
  onDismiss,
}: {
  message: string | null
  tone?: 'success' | 'error' | 'info'
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDismiss, 2800)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  const isError = tone === 'error'
  const isInfo = tone === 'info'

  return (
    <div className="toast-layer" role="status" aria-live="polite">
      <div className={cx('toast', isError && 'is-error', isInfo && 'is-info')}>
        <span
          className={cx(
            'toast-icon',
            isError && 'is-error',
            isInfo && 'is-info',
          )}
        >
          <Icon name={isError ? 'alert' : isInfo ? 'info' : 'check'} size={12} />
        </span>
        {message}
      </div>
    </div>
  )
}
