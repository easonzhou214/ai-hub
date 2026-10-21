import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    if (!state) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 60)
    return () => {
      document.removeEventListener('keydown', handleKey)
      window.clearTimeout(timer)
    }
  }, [state, onCancel])

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
  onDismiss,
}: {
  message: string | null
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDismiss, 2800)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="toast-layer" role="status" aria-live="polite">
      <div className="toast">
        <span className="toast-icon">
          <Icon name="check" size={12} />
        </span>
        {message}
      </div>
    </div>
  )
}
