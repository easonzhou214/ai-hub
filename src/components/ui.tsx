import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Icon } from '../icons'
import type { ProviderStatus, ProviderType } from '../types'
import { BAR_DANGER_PERCENT, QUOTA_WARN_PERCENT, STATUS_META, TYPE_LABEL, cx } from '../utils'

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 4.2c.55 3.9 1.8 5.55 5.5 6.6-3.7 1.05-4.95 2.7-5.5 6.6-.55-3.9-1.8-5.55-5.5-6.6 3.7-1.05 4.95-2.7 5.5-6.6Z"
          fill="currentColor"
        />
        <circle cx="17.6" cy="16.6" r="1.7" fill="currentColor" opacity=".9" />
      </svg>
    </span>
  )
}

export function TypeChip({
  type,
  withDot = true,
}: {
  type: ProviderType
  withDot?: boolean
}) {
  return (
    <span className={cx('type-chip', type)}>
      {withDot && <span className="type-dot" />}
      {TYPE_LABEL[type]}
    </span>
  )
}

export function StatusBadge({ status }: { status: ProviderStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={cx('status-badge', status)} title={meta.hint}>
      <span className="status-dot" />
      {meta.label}
    </span>
  )
}

/** 按「已用比例」定色：用得越多越危险（进度条本身显示剩余比例）。 */
export function usageTone(percent: number | null) {
  if (percent === null) return 'ok' as const
  if (percent >= BAR_DANGER_PERCENT) return 'danger' as const
  if (percent >= QUOTA_WARN_PERCENT) return 'warn' as const
  return 'ok' as const
}

export function ProgressBar({
  value,
  tone,
  thin = false,
  label,
  active = false,
}: {
  value: number | null
  tone?: 'ok' | 'warn' | 'danger'
  thin?: boolean
  label?: string
  /** Codex is currently consuming this quota — animate the remaining bar. */
  active?: boolean
}) {
  const width = value === null ? 0 : Math.min(Math.max(value, 0), 100)
  const resolvedTone = tone ?? usageTone(value)
  const burning = active && width > 0
  return (
    <div
      className={cx(
        'progress',
        `progress-${resolvedTone}`,
        thin && 'progress-thin',
        burning && 'progress-burning',
      )}
      style={{ '--fill': `${width}%` } as CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(width)}
      aria-label={label}
    >
      <span className="progress-fill" style={{ width: `${width}%` }} />
    </div>
  )
}

export function BurningBadge() {
  return (
    <span
      className="codex-live-badge"
      title="最近一次同步发现额度在减少，说明这个供应商正在被使用"
    >
      <Icon name="flame" size={11} />
      正在消耗
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={onChange}
      disabled={disabled}
    >
      <span className="switch-thumb" />
    </button>
  )
}

export interface TabOption<T extends string> {
  value: T
  label: string
  count?: number
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: ReadonlyArray<TabOption<T>>
  onChange: (next: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div className={cx('tabs', className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={cx('tab', value === option.value && 'active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {typeof option.count === 'number' && (
            <span className="tab-count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  icon = 'layers',
  title,
  description,
  action,
}: {
  icon?: ComponentProps<typeof Icon>['name']
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ProviderLogo({
  text,
  color,
  size = 'md',
}: {
  text: string
  color: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={cx('provider-logo', `logo-${size}`)}
      style={{ '--brand': color } as CSSProperties}
      aria-hidden="true"
    >
      {text}
    </span>
  )
}

export function SectionHead({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="section-head">
      <div className="section-copy">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="section-actions">{children}</div>}
    </div>
  )
}
