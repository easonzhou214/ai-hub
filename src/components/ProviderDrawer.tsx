import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useEscapeKey } from '../hooks'
import { Icon } from '../icons'
import type {
  BillingMode,
  Currency,
  Cycle,
  Provider,
  ProviderDraft,
  ProviderPreset,
  ProviderType,
} from '../types'
import {
  CURRENCY_SYMBOL,
  PROVIDER_COLORS,
  TYPE_DESCRIPTION,
  TYPE_LABEL,
  createId,
  cx,
  cycleLabel,
  expiryLabel,
  formatFullDate,
  formatMoney,
  formatQuota,
  getQuotaState,
  isGenerationQuota,
  loginBrand,
  periodQuotaLabel,
  periodUsedLabel,
  relativeTime,
} from '../utils'
import { syncSourcesFor, type SyncSourceId } from '../syncSources'
import { Switch } from './ui'

interface FormState {
  name: string
  vendor: string
  type: ProviderType
  color: string
  baseUrl: string
  apiKey: string
  billing: BillingMode
  currency: Currency
  planName: string
  quotaTotal: string
  quotaUsed: string
  cycle: Cycle
  resetAt: string
  expiresAt: string
  balance: string
  monthlySpend: string
  monthlyBudget: string
  enabled: boolean
  note: string
}

type Errors = Partial<Record<keyof FormState, string>>

interface ProviderDrawerProps {
  open: boolean
  provider: Provider | null
  initialType: ProviderType
  preset?: ProviderPreset | null
  onClose: () => void
  onSave: (draft: ProviderDraft) => void
  onLogin?: (provider: Provider) => void
  loginBusy?: boolean
  /** 上层弹窗打开时让出 Esc 键 */
  escapeDisabled?: boolean
}

const TYPE_DEFAULT_COLOR: Record<ProviderType, string> = {
  coding: '#4D6BFE',
  image: '#E879A9',
}

function defaultResetDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return formatFullDate(date.toISOString())
}

function emptyForm(type: ProviderType): FormState {
  return {
    name: '',
    vendor: '',
    type,
    color: TYPE_DEFAULT_COLOR[type],
    baseUrl: '',
    apiKey: '',
    billing: 'quota',
    currency: 'USD',
    planName: '',
    quotaTotal: '',
    quotaUsed: '0',
    cycle: 'month',
    resetAt: defaultResetDate(),
    expiresAt: '',
    balance: '',
    monthlySpend: '0',
    monthlyBudget: '',
    enabled: true,
    note: '',
  }
}

function pixellabForm(base: FormState): FormState {
  return {
    ...base,
    name: 'PixelLab',
    vendor: 'PixelLab',
    type: 'image',
    color: '#6D5AE6',
    baseUrl: 'https://api.pixellab.ai',
    planName: 'PixelLab 订阅',
    note: '像素美术生成，按订阅次数计费',
  }
}

function fromProvider(provider: Provider): FormState {
  return {
    name: provider.name,
    vendor: provider.vendor,
    type: provider.type,
    color: provider.color,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    billing: provider.billing,
    currency: provider.currency,
    planName: provider.planName,
    quotaTotal: provider.quotaTotal ? String(provider.quotaTotal) : '',
    quotaUsed: String(provider.quotaUsed ?? 0),
    cycle: provider.cycle,
    resetAt: provider.resetAt ? formatFullDate(provider.resetAt) : '',
    expiresAt: provider.expiresAt ? formatFullDate(provider.expiresAt) : '',
    balance:
      provider.balance === 0 || provider.balance
        ? String(provider.balance)
        : '',
    monthlySpend: String(provider.monthlySpend ?? 0),
    monthlyBudget: provider.monthlyBudget
      ? String(provider.monthlyBudget)
      : '',
    enabled: provider.enabled,
    note: provider.note ?? '',
  }
}

function parseAmount(value: string) {
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return Number.NaN
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function dateToISO(value: string) {
  if (!value) return ''
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function ProviderDrawer({
  open,
  provider,
  initialType,
  preset = null,
  onClose,
  onSave,
  onLogin,
  loginBusy = false,
  escapeDisabled = false,
}: ProviderDrawerProps) {
  const uid = useId()
  const [form, setForm] = useState<FormState>(() => emptyForm(initialType))
  const [errors, setErrors] = useState<Errors>({})
  const [showKey, setShowKey] = useState(false)
  const [syncSource, setSyncSource] = useState<SyncSourceId | 'manual'>(
    'manual',
  )
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setForm(
      provider
        ? fromProvider(provider)
        : preset === 'pixellab'
          ? pixellabForm(emptyForm('image'))
          : emptyForm(initialType),
    )
    setErrors({})
    setShowKey(false)
    setAdvancedOpen(false)
    setSyncSource(
      (provider?.syncMode ?? preset) === 'pixellab' ? 'pixellab' : 'manual',
    )
    let timer: number | undefined
    if (window.matchMedia('(min-width: 761px)').matches) {
      timer = window.setTimeout(() => nameRef.current?.focus(), 260)
    }
    return () => {
      if (timer) window.clearTimeout(timer)
    }
    // 只依赖 provider.id：同步会更新 provider 对象，若把它放进依赖，用户
    // 正在填写的内容会被重置；而 provider 本身已经是最新对象，保存时够用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.id, initialType, preset])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  // 抽屉里可以打开登录弹窗，此时 Esc 应该只关弹窗，不能把抽屉和未保存的
  // 修改一起关掉，所以由父组件传入 escapeDisabled 让位。
  useEscapeKey(open && !escapeDisabled, onClose)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const chooseType = (nextType: ProviderType) => {
    setForm((current) => {
      const shouldSwapColor =
        !provider &&
        (current.color === TYPE_DEFAULT_COLOR.coding ||
          current.color === TYPE_DEFAULT_COLOR.image)
      return {
        ...current,
        type: nextType,
        color: shouldSwapColor ? TYPE_DEFAULT_COLOR[nextType] : current.color,
      }
    })
  }

  const chooseBilling = (nextBilling: BillingMode) => {
    setForm((current) => ({ ...current, billing: nextBilling }))
    setErrors({})
  }

  const isCcSynced = provider?.syncMode === 'openai-billing'
  // PixelLab 账户不来自 CC Switch，用「接口同步」开关切换同步方式。
  const availableSources = syncSourcesFor(form.type)
  const autoSource = isCcSynced
    ? undefined
    : availableSources.find((source) => source.id === syncSource)
  const autoSourceActive = Boolean(autoSource)
  const isAutoSynced = isCcSynced || autoSourceActive

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: Errors = {}
    const name = form.name.trim()
    if (!name) nextErrors.name = '请填写供应商名称'
    else if (name.length > 40) nextErrors.name = '名称请控制在 40 个字符以内'

    const baseUrl = form.baseUrl.trim()
    if (baseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
      nextErrors.baseUrl = '请以 http:// 或 https:// 开头'
    }

    if (autoSourceActive && !form.apiKey.trim()) {
      nextErrors.apiKey = 'PixelLab 接口同步需要 API Token'
    }

    let quotaTotal = provider?.quotaTotal ?? 0
    let quotaUsed = provider?.quotaUsed ?? 0
    let balance = provider?.balance ?? 0
    let monthlySpend = provider?.monthlySpend ?? 0
    let monthlyBudget = provider?.monthlyBudget ?? 0

    if (!isAutoSynced) {
      if (form.billing === 'quota') {
        const total = parseAmount(form.quotaTotal)
        const used = parseAmount(form.quotaUsed)
        if (!Number.isFinite(total) || total <= 0) {
          nextErrors.quotaTotal = '额度总量需大于 0'
        }
        if (!Number.isFinite(used) || used < 0) {
          nextErrors.quotaUsed = '已使用额度不能小于 0'
        } else if (
          !nextErrors.quotaTotal &&
          Number.isFinite(total) &&
          used > total
        ) {
          nextErrors.quotaUsed = '已使用额度不能大于额度总量'
        }
        if (!form.resetAt) nextErrors.resetAt = '请选择下次重置日期'
        quotaTotal = total
        quotaUsed = used
      } else {
        const currentBalance = parseAmount(form.balance)
        const spend = parseAmount(form.monthlySpend)
        const budget = form.monthlyBudget.trim()
          ? parseAmount(form.monthlyBudget)
          : 0
        if (!Number.isFinite(currentBalance) || currentBalance < 0) {
          nextErrors.balance = '请填写有效的当前余额'
        }
        if (!Number.isFinite(spend) || spend < 0) {
          nextErrors.monthlySpend = '本月已用不能小于 0'
        }
        if (
          form.monthlyBudget.trim() &&
          (!Number.isFinite(budget) || budget < 0)
        ) {
          nextErrors.monthlyBudget = '预算不能小于 0'
        }
        balance = currentBalance
        monthlySpend = spend
        monthlyBudget = budget
      }
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      const firstKey = Object.keys(nextErrors)[0]
      if (nextErrors.baseUrl || nextErrors.apiKey) setAdvancedOpen(true)
      window.setTimeout(() => {
        const target = document.querySelector<HTMLElement>(
          `[data-field="${firstKey}"] input, [data-field="${firstKey}"] select, [data-field="${firstKey}"]`,
        )
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target?.focus({ preventScroll: true })
      }, 140)
      return
    }

    const now = new Date().toISOString()
    const draft: ProviderDraft = {
      id: provider?.id ?? createId(),
      createdAt: provider?.createdAt ?? now,
      updatedAt: now,
      name,
      vendor: form.vendor.trim() || name,
      type: form.type,
      color: form.color,
      baseUrl,
      apiKey: form.apiKey.trim(),
      billing: isAutoSynced ? (provider?.billing ?? 'quota') : form.billing,
      currency: isAutoSynced ? (provider?.currency ?? 'USD') : form.currency,
      planName:
        form.planName.trim() ||
        (autoSourceActive
          ? 'PixelLab 订阅'
          : isAutoSynced
            ? provider?.planName || '接口额度账户'
            : form.billing === 'quota'
              ? '手动额度套餐'
              : '按量计费'),
      quotaTotal,
      quotaUsed,
      cycle: isAutoSynced ? (provider?.cycle ?? 'month') : form.cycle,
      resetAt: isAutoSynced
        ? (provider?.resetAt ?? '')
        : form.billing === 'quota'
          ? dateToISO(form.resetAt)
          : '',
      expiresAt: isAutoSynced
        ? (provider?.expiresAt ?? '')
        : form.expiresAt
          ? dateToISO(form.expiresAt)
          : '',
      balance,
      monthlySpend,
      monthlyBudget,
      callsToday: provider?.callsToday ?? 0,
      successRate: provider?.successRate ?? 1,
      enabled: form.enabled,
      note: form.note.trim(),
      syncMode: isCcSynced
        ? 'openai-billing'
        : autoSource
          ? autoSource.id
          : 'manual',
      quotaUnit: autoSourceActive ? 'generation' : provider?.quotaUnit,
      unlimited: provider?.unlimited ?? false,
      limitUnknown: provider?.limitUnknown ?? false,
      keyUnlimited: provider?.keyUnlimited ?? false,
      lifetimeUsed: provider?.lifetimeUsed ?? 0,
      accountBalance: provider?.accountBalance,
      loginProvider: provider?.loginProvider,
      loginRequired: provider?.loginRequired,
      lastSyncedAt: provider?.lastSyncedAt ?? '',
      // 保存配置不修复同步故障，保留原有错误直到下一次同步成功。
      syncError: provider?.syncError ?? '',
      source: provider?.source,
      sourceId: provider?.sourceId,
      modelCount: provider?.modelCount,
    }
    onSave(draft)
  }

  const isEditing = Boolean(provider)
  const moneySymbol = CURRENCY_SYMBOL[form.currency]
  // 手动接管 PixelLab 账户时仍按「次」录入，不要把次数标成美元。
  const quotaSymbol =
    provider?.quotaUnit === 'generation' && !autoSourceActive
      ? '次'
      : moneySymbol
  const autoQuota = provider ? getQuotaState(provider) : null
  const needsLogin = Boolean(
    provider?.loginRequired && provider?.loginProvider,
  )
  const loginLabel = provider ? loginBrand(provider) : ''
  const isUnknownLimit = Boolean(provider?.limitUnknown)
  const hasPlanQuota = Boolean(
    autoQuota && autoQuota.percent !== null && autoQuota.total !== null,
  )
  const hasWallet = provider?.accountBalance !== undefined
  const hasAccountBalance = hasWallet && !hasPlanQuota
  const autoPeriod = Boolean(
    autoQuota &&
      autoQuota.percent !== null &&
      (provider?.resetAt || provider?.syncMode === 'pixellab'),
  )
  const autoCumulative = provider?.lifetimeUsed ?? provider?.quotaUsed ?? 0

  return (
    <>
      <div
        className={cx('sheet-backdrop', open && 'is-open')}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cx('sheet', open && 'is-open')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-hidden={!open}
      >
        <form className="sheet-form" onSubmit={handleSubmit} noValidate>
          <header className="sheet-head">
            <div>
              <p className="sheet-eyebrow">供应商配置</p>
              <h2 id={`${uid}-title`}>
                {isEditing ? '编辑供应商' : '添加供应商'}
              </h2>
              <p className="sheet-subtitle">
                {isEditing && isAutoSynced
                  ? '调整展示与接口配置，额度会通过供应商 token / 账户接口自动同步。'
                  : '录入额度或余额后，用量会自动汇总到看板。'}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭面板"
              onClick={onClose}
            >
              <Icon name="x" size={17} />
            </button>
          </header>

          <div className="sheet-body">
            {provider && isAutoSynced && (
              <div className="auto-sync-banner">
                <span className="auto-sync-icon">
                  <Icon name="refresh" size={14} />
                </span>
                <div>
                  <strong>接口自动同步</strong>
                  <p>
                    {provider.syncMode === 'pixellab'
                      ? '额度来自 PixelLab 账户接口（api.pixellab.ai/v2/balance），手动修改会在下次同步时被覆盖。'
                      : `额度来自供应商的 token / 账户接口${
                          provider.source === 'cc-switch'
                            ? '（via CC Switch）'
                            : ''
                        }，手动修改会在下次同步时被覆盖。`}
                  </p>
                </div>
              </div>
            )}

            <section className="form-section">
              <div className="form-section-head">
                <span className="form-section-index">01</span>
                <div>
                  <h3>基本信息</h3>
                  <p>用于在列表与额度卡片中识别这个供应商。</p>
                </div>
              </div>

              {!provider && form.type === 'image' && (
                <div className="preset-row">
                  <span className="preset-label">快速开始</span>
                  <button
                    type="button"
                    className={cx(
                      'preset-chip',
                      syncSource === 'pixellab' &&
                        form.name === 'PixelLab' &&
                        'is-active',
                    )}
                    onClick={() => {
                      setForm((current) => pixellabForm(current))
                      setSyncSource('pixellab')
                      setErrors({})
                    }}
                  >
                    <span
                      className="preset-dot"
                      style={{ background: '#6D5AE6' }}
                    />
                    <strong>PixelLab</strong>
                    <span>像素美术 · 按次计费</span>
                    <Icon name="sparkles" size={12} />
                  </button>
                </div>
              )}

              <div className="field full">
                <span className="field-label">供应商类型</span>
                <div
                  className="type-select"
                  role="radiogroup"
                  aria-label="供应商类型"
                >
                  {(['coding', 'image'] as ProviderType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={form.type === type}
                      className={cx(
                        'type-option',
                        form.type === type && 'active',
                      )}
                      onClick={() => chooseType(type)}
                    >
                      <span className="type-option-icon">
                        <Icon name={type === 'coding' ? 'code' : 'image'} size={15} />
                      </span>
                      <span className="type-option-copy">
                        <strong>{TYPE_LABEL[type]}</strong>
                        <span>{TYPE_DESCRIPTION[type]}</span>
                      </span>
                      <span className="type-option-check">
                        {form.type === type && <Icon name="check" size={11} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-grid">
                <Field
                  label="名称"
                  htmlFor={`${uid}-name`}
                  error={errors.name}
                  className="full"
                  fieldKey="name"
                >
                  <input
                    ref={nameRef}
                    id={`${uid}-name`}
                    value={form.name}
                    onChange={(event) => update('name', event.target.value)}
                    placeholder="例如：Claude Max、即梦 Seedream"
                    autoComplete="off"
                  />
                </Field>

                <Field
                  label="服务商 / 平台"
                  htmlFor={`${uid}-vendor`}
                  hint="留空则使用名称"
                  fieldKey="vendor"
                >
                  <input
                    id={`${uid}-vendor`}
                    value={form.vendor}
                    onChange={(event) => update('vendor', event.target.value)}
                    placeholder="Anthropic / OpenAI"
                    autoComplete="off"
                  />
                </Field>

                <Field
                  label="标识色"
                  hint="用于头像与图表"
                  className="color-field"
                >
                  <div className="color-row">
                    {PROVIDER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cx(
                          'color-swatch',
                          form.color === color && 'active',
                        )}
                        style={{ background: color }}
                        aria-label={`选择标识色 ${color}`}
                        aria-pressed={form.color === color}
                        onClick={() => update('color', color)}
                      >
                        {form.color === color && <Icon name="check" size={11} />}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </section>

            <section className="form-section">
              <div className="form-section-head">
                <span className="form-section-index">02</span>
                <div>
                  <h3>额度与计费</h3>
                  <p>
                    {isAutoSynced
                      ? '额度由供应商接口自动同步，无需手动维护。'
                      : availableSources.length
                        ? '手动录入，或选择一个接口来源自动同步。'
                        : '手动录入额度与重置周期。'}
                  </p>
                </div>
              </div>

              {!isCcSynced && availableSources.length > 0 && (
                <Field
                  label="额度来源"
                  htmlFor={`${uid}-sync-source`}
                  fieldKey="syncSource"
                  hint={
                    autoSource
                      ? `${autoSource.summary}${
                          provider ? '' : '保存后会立即同步一次。'
                        }`
                      : '手动录入的额度不会被接口覆盖。'
                  }
                >
                  <select
                    id={`${uid}-sync-source`}
                    value={autoSource ? autoSource.id : 'manual'}
                    onChange={(event) =>
                      setSyncSource(
                        event.target.value as SyncSourceId | 'manual',
                      )
                    }
                  >
                    <option value="manual">手动录入</option>
                    {availableSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {isAutoSynced && provider && autoQuota ? (
                <div className="auto-quota-block">
                  <div className="form-grid">
                    <Field
                      label="套餐名称"
                      htmlFor={`${uid}-plan-auto`}
                      className="full"
                      fieldKey="planName"
                      hint={
                        provider.syncMode === 'pixellab'
                          ? '由 PixelLab 返回的套餐名覆盖'
                          : '仅用于看板展示，不影响接口额度'
                      }
                    >
                      <input
                        id={`${uid}-plan-auto`}
                        value={form.planName}
                        disabled={provider.syncMode === 'pixellab'}
                        onChange={(event) =>
                          update('planName', event.target.value)
                        }
                        placeholder="例如：Codex · gpt-6.1-sol"
                        autoComplete="off"
                      />
                    </Field>
                  </div>

                  <div className="auto-quota-grid">
                    {needsLogin ? (
                      <>
                        <div>
                          <span>账户额度</span>
                          <strong>需要登录</strong>
                        </div>
                        <div>
                          <span>登录方式</span>
                          <strong>{loginLabel} 网页</strong>
                        </div>
                        <div>
                          <span>上次同步</span>
                          <strong>
                            {provider.lastSyncedAt
                              ? relativeTime(provider.lastSyncedAt)
                              : '—'}
                          </strong>
                        </div>
                      </>
                    ) : isUnknownLimit ? (
                      <>
                        <div>
                          <span>账户额度</span>
                          <strong>待确认</strong>
                        </div>
                        <div>
                          <span>累计已用</span>
                          <strong>
                            {formatMoney(
                              autoCumulative,
                              provider.currency,
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>查询状态</span>
                          <strong>API Key 不限额</strong>
                        </div>
                      </>
                    ) : hasAccountBalance ? (
                      <>
                        <div>
                          <span>账户余额</span>
                          <strong>
                            {formatMoney(
                              provider.accountBalance ?? 0,
                              provider.currency,
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>累计已用</span>
                          <strong>
                            {formatMoney(
                              autoCumulative,
                              provider.currency,
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>查询方式</span>
                          <strong>用户额度</strong>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span>
                            {autoPeriod ? periodQuotaLabel(provider) : '账户总额'}
                          </span>
                          <strong>
                            {provider.unlimited
                              ? '不限额度'
                              : formatQuota(
                                  provider.quotaTotal,
                                  provider,
                                )}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {autoPeriod ? periodUsedLabel(provider) : '累计已用'}
                          </span>
                          <strong>
                            {autoPeriod
                              ? formatQuota(provider.quotaUsed, provider)
                              : formatMoney(
                                  autoCumulative,
                                  provider.currency,
                                )}
                          </strong>
                        </div>
                        <div>
                          <span>剩余额度</span>
                          <strong>
                            {provider.unlimited
                              ? '无上限'
                              : formatQuota(autoQuota.available, provider)}
                          </strong>
                        </div>
                      </>
                    )}
                  </div>

                  {hasPlanQuota && hasWallet && provider && (
                    <div className="auto-wallet-row">
                      <span>
                        <Icon name="wallet" size={12} />
                        钱包余额
                      </span>
                      <strong>
                        {formatMoney(
                          provider.accountBalance ?? 0,
                          provider.currency,
                        )}
                      </strong>
                    </div>
                  )}

                  {provider &&
                    (provider.monthQuota ||
                      provider.subscriptionPlan ||
                      provider.subscriptionId ||
                      provider.expiresAt ||
                      (provider.entryRoutes &&
                        provider.entryRoutes.length > 0)) && (
                      <div className="auto-plan-meta">
                        {provider.subscriptionPlan && (
                          <div>
                            <span>订阅套餐</span>
                            <strong>{provider.subscriptionPlan}</strong>
                          </div>
                        )}
                        {provider.monthQuota && (
                          <div>
                            <span>月额度（套餐总额）</span>
                            <strong>
                              剩余{' '}
                              {formatQuota(
                                provider.monthQuota.remaining,
                                provider,
                              )}{' '}
                              /{' '}
                              {formatQuota(provider.monthQuota.total, provider)}
                            </strong>
                          </div>
                        )}
                        {provider.subscriptionId && (
                          <div>
                            <span>订阅编号</span>
                            <strong>#{provider.subscriptionId}</strong>
                          </div>
                        )}
                        {provider.expiresAt && (
                          <div>
                            <span>套餐到期</span>
                            <strong>
                              {formatFullDate(provider.expiresAt)}
                              <small> · {expiryLabel(provider)}</small>
                            </strong>
                          </div>
                        )}
                        {provider.entryRoutes &&
                          provider.entryRoutes.length > 0 && (
                            <div>
                              <span>可用端点</span>
                              <strong>{provider.entryRoutes.join(' / ')}</strong>
                            </div>
                          )}
                      </div>
                    )}

                  {needsLogin && (
                    <>
                      <p className="auto-quota-help">
                        <Icon name="info" size={12} />
                        该供应商的账户额度需要在 {loginLabel} 网页完成登录后读取。
                        AI Hub 会打开独立的 Chrome 登录窗口，不会保存你的登录密码。
                      </p>
                      <button
                        type="button"
                        className="btn btn-soft btn-sm auto-login-button"
                        onClick={() => provider && onLogin?.(provider)}
                        disabled={loginBusy || !onLogin}
                      >
                        <Icon name="key" size={12} />
                        {loginBusy ? '登录中…' : `登录 ${loginLabel}`}
                      </button>
                    </>
                  )}

                  {isUnknownLimit && !needsLogin && (
                    <p className="auto-quota-help">
                      <Icon name="info" size={12} />
                      API Key 的 unlimited_quota 只代表 Key 本身；这家没有为这个 Key 开放账户额度查询。
                      账户额度需要供应商后台的账户访问令牌，或在后台查看；当前只展示接口返回的累计用量。
                    </p>
                  )}

                  <div className="auto-quota-foot">
                    <span>
                      <Icon name="refresh" size={12} />
                      上次同步{' '}
                      {provider.lastSyncedAt
                        ? relativeTime(provider.lastSyncedAt)
                        : '等待首次同步'}
                    </span>
                    <span>
                      {isGenerationQuota(provider)
                        ? '次数'
                        : provider.currency}
                      {needsLogin
                        ? ' · 需要网页登录'
                        : autoPeriod
                          ? ` · ${cycleLabel(provider.cycle)}重置`
                          : isUnknownLimit
                            ? ' · 账户额度待授权'
                            : ' · 接口额度'}
                    </span>
                  </div>
                </div>
              ) : null}

              {!isAutoSynced && (
                <>
              <div className="field full">
                <span className="field-label">计费方式</span>
                <div
                  className="billing-select"
                  role="radiogroup"
                  aria-label="计费方式"
                >
                  {(
                    [
                      {
                        value: 'quota',
                        icon: 'calendar',
                        title: '周期额度',
                        desc: '套餐总额度，按周期重置',
                      },
                      {
                        value: 'balance',
                        icon: 'wallet',
                        title: '预充值余额',
                        desc: '余额扣减，可设置月度预算',
                      },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={form.billing === option.value}
                      className={cx(
                        'billing-option',
                        form.billing === option.value && 'active',
                      )}
                      onClick={() => chooseBilling(option.value)}
                    >
                      <span className="billing-option-top">
                        <Icon name={option.icon} size={14} />
                        <strong>{option.title}</strong>
                        <span className="billing-radio" />
                      </span>
                      <span className="billing-desc">{option.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-grid">
                <Field
                  label="套餐名称"
                  htmlFor={`${uid}-plan`}
                  className="full"
                  fieldKey="planName"
                  hint="留空将使用默认名称"
                >
                  <input
                    id={`${uid}-plan`}
                    value={form.planName}
                    onChange={(event) => update('planName', event.target.value)}
                    placeholder={
                      form.billing === 'quota'
                        ? '例如：Max 20× 订阅'
                        : '例如：Pay as you go'
                    }
                    autoComplete="off"
                  />
                </Field>

                {form.billing === 'quota' ? (
                  <>
                    <Field
                      label="额度总量"
                      htmlFor={`${uid}-quota-total`}
                      error={errors.quotaTotal}
                      fieldKey="quotaTotal"
                    >
                      <MoneyInput
                        id={`${uid}-quota-total`}
                        symbol={quotaSymbol}
                        value={form.quotaTotal}
                        onChange={(value) => update('quotaTotal', value)}
                        placeholder="200"
                      />
                    </Field>

                    <Field
                      label="已使用额度"
                      htmlFor={`${uid}-quota-used`}
                      error={errors.quotaUsed}
                      fieldKey="quotaUsed"
                    >
                      <MoneyInput
                        id={`${uid}-quota-used`}
                        symbol={quotaSymbol}
                        value={form.quotaUsed}
                        onChange={(value) => update('quotaUsed', value)}
                        placeholder="0"
                      />
                    </Field>

                    <Field label="币种" htmlFor={`${uid}-currency`}>
                      <select
                        id={`${uid}-currency`}
                        value={form.currency}
                        onChange={(event) =>
                          update('currency', event.target.value as Currency)
                        }
                      >
                        <option value="USD">USD · 美元 ($)</option>
                        <option value="CNY">CNY · 人民币 (¥)</option>
                      </select>
                    </Field>

                    <Field label="重置周期" htmlFor={`${uid}-cycle`}>
                      <select
                        id={`${uid}-cycle`}
                        value={form.cycle}
                        onChange={(event) =>
                          update('cycle', event.target.value as Cycle)
                        }
                      >
                        <option value="day">每天重置</option>
                        <option value="week">每周重置</option>
                        <option value="month">每月重置</option>
                      </select>
                    </Field>

                    <Field
                      label="下次重置日期"
                      htmlFor={`${uid}-reset`}
                      error={errors.resetAt}
                      fieldKey="resetAt"
                    >
                      <input
                        id={`${uid}-reset`}
                        type="date"
                        value={form.resetAt}
                        onChange={(event) => update('resetAt', event.target.value)}
                      />
                    </Field>

                    <Field
                      label="套餐到期日期"
                      htmlFor={`${uid}-expires`}
                      hint="可选，用于到期提醒"
                      fieldKey="expiresAt"
                    >
                      <input
                        id={`${uid}-expires`}
                        type="date"
                        value={form.expiresAt}
                        onChange={(event) =>
                          update('expiresAt', event.target.value)
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field
                      label="当前余额"
                      htmlFor={`${uid}-balance`}
                      error={errors.balance}
                      fieldKey="balance"
                    >
                      <MoneyInput
                        id={`${uid}-balance`}
                        symbol={moneySymbol}
                        value={form.balance}
                        onChange={(value) => update('balance', value)}
                        placeholder="100.00"
                      />
                    </Field>

                    <Field label="币种" htmlFor={`${uid}-currency`}>
                      <select
                        id={`${uid}-currency`}
                        value={form.currency}
                        onChange={(event) =>
                          update('currency', event.target.value as Currency)
                        }
                      >
                        <option value="USD">USD · 美元 ($)</option>
                        <option value="CNY">CNY · 人民币 (¥)</option>
                      </select>
                    </Field>

                    <Field
                      label="本月已用"
                      htmlFor={`${uid}-spend`}
                      error={errors.monthlySpend}
                      fieldKey="monthlySpend"
                    >
                      <MoneyInput
                        id={`${uid}-spend`}
                        symbol={moneySymbol}
                        value={form.monthlySpend}
                        onChange={(value) => update('monthlySpend', value)}
                        placeholder="0.00"
                      />
                    </Field>

                    <Field
                      label="月度预算"
                      htmlFor={`${uid}-budget`}
                      error={errors.monthlyBudget}
                      fieldKey="monthlyBudget"
                      hint="可选，用于展示使用进度"
                    >
                      <MoneyInput
                        id={`${uid}-budget`}
                        symbol={moneySymbol}
                        value={form.monthlyBudget}
                        onChange={(value) => update('monthlyBudget', value)}
                        placeholder="留空则不显示进度"
                      />
                    </Field>

                    <Field
                      label="套餐到期日期"
                      htmlFor={`${uid}-expires`}
                      className="full"
                      hint="可选，用于到期提醒"
                      fieldKey="expiresAt"
                    >
                      <input
                        id={`${uid}-expires`}
                        type="date"
                        value={form.expiresAt}
                        onChange={(event) =>
                          update('expiresAt', event.target.value)
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
                </>
              )}
            </section>

            <section className="form-section">
              <div className="form-section-head">
                <span className="form-section-index">03</span>
                <div>
                  <h3>接口与凭证</h3>
                  <p>可选，便于后续接入额度自动同步。</p>
                </div>
              </div>

              <button
                type="button"
                className={cx('advanced-toggle', advancedOpen && 'open')}
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                <span className="advanced-icon">
                  <Icon name="key" size={14} />
                </span>
                <span className="advanced-copy">
                  <strong>
                    {form.apiKey || form.baseUrl
                      ? '已填写接口信息'
                      : '填写 Base URL 与 API Key'}
                  </strong>
                  <em>
                    随配置同步到服务端状态文件（明文，权限 0600），不填也能保存
                  </em>
                </span>
                <span className="advanced-side">
                  {form.apiKey && (
                    <span className="advanced-saved">
                      <Icon name="check" size={10} />
                      Key 已保存
                    </span>
                  )}
                  <Icon
                    name="chevron-down"
                    size={14}
                    className={cx('advanced-chevron', advancedOpen && 'open')}
                  />
                </span>
              </button>

              {advancedOpen && (
                <div className="form-grid advanced-panel">
                  <Field
                    label="Base URL"
                    htmlFor={`${uid}-url`}
                    error={errors.baseUrl}
                    className="full"
                    fieldKey="baseUrl"
                    hint="例如 https://api.anthropic.com"
                  >
                    <input
                      id={`${uid}-url`}
                      value={form.baseUrl}
                      onChange={(event) => update('baseUrl', event.target.value)}
                      placeholder="https://api.example.com/v1"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>

                  <Field
                    label="API Key"
                    htmlFor={`${uid}-key`}
                    className="full"
                    fieldKey="apiKey"
                    hint="随配置写入服务端状态文件（明文），导出时会剔除"
                  >
                    <div className="input-with-action">
                      <span className="input-leading">
                        <Icon name="key" size={14} />
                      </span>
                      <input
                        id={`${uid}-key`}
                        type={showKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(event) =>
                          update('apiKey', event.target.value)
                        }
                        placeholder="sk-..."
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="input-action"
                        aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                        onClick={() => setShowKey((value) => !value)}
                      >
                        <Icon name={showKey ? 'eye-off' : 'eye'} size={15} />
                      </button>
                    </div>
                  </Field>
                </div>
              )}
            </section>

            <section className="form-section">
              <div className="form-section-head">
                <span className="form-section-index">04</span>
                <div>
                  <h3>状态与备注</h3>
                  <p>停用后仍保留配置，但不计入汇总统计。</p>
                </div>
              </div>

              <div className="switch-row">
                <div>
                  <strong>启用供应商</strong>
                  <span>参与额度汇总、今日调用与到期提醒</span>
                </div>
                <Switch
                  checked={form.enabled}
                  onChange={() =>
                setForm((current) => ({ ...current, enabled: !current.enabled }))
              }
                  label="启用供应商"
                />
              </div>

              <div className="field full">
                <label className="field-label" htmlFor={`${uid}-note`}>
                  备注
                  <span className="field-optional">可选</span>
                </label>
                <textarea
                  id={`${uid}-note`}
                  value={form.note}
                  onChange={(event) => update('note', event.target.value)}
                  placeholder="例如：主力编程模型，额度告急时切换备用"
                  rows={3}
                />
              </div>
            </section>
          </div>

          <footer className="sheet-foot">
            <span className="sheet-foot-hint">
              <Icon name="lock" size={12} />
              保存后写入服务端，其他设备可见
            </span>
            <div className="sheet-foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                <Icon name={isEditing ? 'check' : 'plus'} size={14} />
                {isEditing ? '保存修改' : '添加供应商'}
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  fieldKey,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
  fieldKey?: string
}) {
  return (
    <div
      className={cx('field', className, error && 'has-error')}
      data-field={fieldKey}
    >
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  )
}

function MoneyInput({
  id,
  symbol,
  value,
  onChange,
  placeholder,
}: {
  id: string
  symbol: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="input-with-prefix">
      <span className="input-prefix">{symbol}</span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
      />
    </div>
  )
}
