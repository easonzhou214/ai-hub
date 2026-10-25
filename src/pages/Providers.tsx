import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import type { Provider, ProviderPreset, ProviderType } from '../types'
import { describeProvider } from '../providerView'
import {
  cx,
  cycleLabel,
  formatPercent,
  formatQuota,
  logoText,
} from '../utils'
import {
  CodexLiveBadge,
  EmptyState,
  ProgressBar,
  ProviderLogo,
  StatusBadge,
  Switch,
  Tabs,
  TypeChip,
  usageTone,
} from '../components/ui'

type Filter = 'all' | ProviderType

interface ProvidersPageProps {
  providers: Provider[]
  importing: boolean
  onAdd: (type?: ProviderType) => void
  onAddPreset?: (preset: ProviderPreset) => void
  onImport: () => void
  /** 这台设备读不到 CC Switch 时给出的原因，按钮据此置灰。 */
  importBlockedReason?: string | null
  onEdit: (provider: Provider) => void
  onToggle: (provider: Provider) => void
  onDelete: (provider: Provider) => void
  onLogin: (provider: Provider) => void
  loginBusyId?: string
  codexProviderId?: string
}

function hostOf(url: string) {
  if (!url) return '未填写接口地址'
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function ProvidersPage({
  providers,
  importing,
  onAdd,
  onAddPreset,
  onImport,
  importBlockedReason,
  onEdit,
  onToggle,
  onDelete,
  onLogin,
  loginBusyId,
  codexProviderId,
}: ProvidersPageProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const counts = {
    all: providers.length,
    coding: providers.filter((provider) => provider.type === 'coding').length,
    image: providers.filter((provider) => provider.type === 'image').length,
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return providers.filter((provider) => {
      if (filter !== 'all' && provider.type !== filter) return false
      if (!keyword) return true
      return [
        provider.name,
        provider.vendor,
        provider.planName,
        provider.baseUrl,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [providers, filter, query])

  const addType = filter === 'all' ? undefined : filter

  return (
    <div className="page providers-page">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>供应商</h1>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onImport}
            disabled={importing || Boolean(importBlockedReason)}
            title={importBlockedReason ?? undefined}
          >
            <Icon
              name="refresh"
              size={14}
              className={importing ? 'spinning' : undefined}
            />
            {importing ? '导入中…' : '从 CC Switch 导入'}
          </button>
          {onAddPreset && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onAddPreset('pixellab')}
              title="预填 PixelLab 的名称、类型与接口地址"
            >
              <Icon name="sparkles" size={14} />
              添加 PixelLab
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onAdd(addType)}
          >
            <Icon name="plus" size={14} />
            添加供应商
          </button>
        </div>
      </div>

      <div className="list-toolbar">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          ariaLabel="按供应商类型筛选"
          options={[
            { value: 'all', label: '全部', count: counts.all },
            { value: 'coding', label: '编程', count: counts.coding },
            { value: 'image', label: '绘图', count: counts.image },
          ]}
        />
        <div className="toolbar-right">
          <span className="toolbar-count">共 {filtered.length} 个</span>
          <label className="search-box">
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、平台或套餐"
              aria-label="搜索供应商"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="清除搜索"
                onClick={() => setQuery('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </label>
        </div>
      </div>

      <div className="panel provider-table-panel">
        {providers.length === 0 ? (
          <EmptyState
            icon="server"
            title="还没有供应商"
            description="添加你的第一个编程或绘图供应商，开始统一跟踪额度。"
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onAdd(addType)}
              >
                <Icon name="plus" size={14} />
                添加供应商
              </button>
            }
          />
        ) : filtered.length === 0 && !query && filter !== 'all' ? (
          <EmptyState
            icon={filter === 'image' ? 'image' : 'code'}
            title={filter === 'image' ? '还没有绘图供应商' : '还没有编程供应商'}
            description={
              filter === 'image'
                ? 'PixelLab 这类按次计费的美术账户可以直接接进来，额度自动同步。'
                : '添加一个编程供应商，开始跟踪额度与重置时间。'
            }
            action={
              filter === 'image' && onAddPreset ? (
                <div className="empty-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onAddPreset('pixellab')}
                  >
                    <Icon name="sparkles" size={14} />
                    添加 PixelLab
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onAdd('image')}
                  >
                    手动添加
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onAdd(addType)}
                >
                  <Icon name="plus" size={14} />
                  添加供应商
                </button>
              )
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="search"
            title="没有找到匹配的供应商"
            description="试试其他关键词，或切换供应商类型。"
            action={
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                清除筛选
              </button>
            }
          />
        ) : (
          <div className="provider-table">
            <div className="pt-head">
              <span>供应商</span>
              <span>套餐 / 类型</span>
              <span>剩余额度</span>
              <span>状态</span>
              <span className="pt-head-actions">启用 / 操作</span>
            </div>
            {filtered.map((provider) => {
              const {
                quota,
                remaining,
                status,
                expiry,
                synced,
                needsLogin,
                loginLabel,
                unlimited,
                unknown,
                hasPlanQuota,
                hasAccountBalance,
                cumulative,
                planBased,
                noData,
                lastSync,
                money,
              } = describeProvider(provider)
              const codexActive = provider.id === codexProviderId
              return (
                <div
                  key={provider.id}
                  className={cx(
                    'pt-row',
                    !provider.enabled && 'is-disabled',
                    codexActive && 'is-codex-active',
                  )}
                >
                  <div className="pt-provider">
                    <ProviderLogo
                      text={logoText(provider)}
                      color={provider.color}
                      size="md"
                    />
                    <div className="pt-provider-copy">
                      <div className="pt-name">
                        <strong>{provider.name}</strong>
                        {synced && (
                          <span className="pt-live" title="额度来自供应商接口">
                            <Icon name="refresh" size={9} />
                            接口
                          </span>
                        )}
                      </div>
                      <span className="pt-sub">
                        {provider.vendor}
                        {provider.baseUrl && (
                          <>
                            <span className="pt-dot" />
                            {hostOf(provider.baseUrl)}
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="pt-plan">
                    <div className="pt-plan-line">
                      <TypeChip type={provider.type} />
                      <span className="pt-plan-name">{provider.planName}</span>
                    </div>
                    <span className="pt-sub">
                      {synced ? (
                        <>
                          {provider.source === 'cc-switch'
                            ? 'CC Switch'
                            : '供应商接口'}
                          {' · '}
                          {needsLogin
                            ? `需要登录 ${loginLabel}`
                            : provider.syncError
                              ? '接口同步失败'
                              : unknown
                                ? '账户额度待确认'
                                : planBased
                                  ? '周期额度'
                                  : hasAccountBalance
                                    ? '账户余额'
                                    : '接口同步'}
                          {provider.modelCount
                            ? ` · ${provider.modelCount} 个模型`
                            : ''}
                        </>
                      ) : (
                        <>
                          {provider.billing === 'quota'
                            ? `${cycleLabel(provider.cycle)}重置`
                            : '按量扣减余额'}
                          {provider.apiKey ? ' · 已保存 Key' : ''}
                        </>
                      )}
                    </span>
                  </div>

                  <div className="pt-usage">
                    <div className="pt-usage-head">
                      {needsLogin ? (
                        <span className="pt-percent">
                          需要登录
                          <span>账户额度</span>
                        </span>
                      ) : noData ? (
                        <span className="pt-percent">
                          读取失败
                          <span>账户额度</span>
                        </span>
                      ) : unknown ? (
                        <span className="pt-percent">
                          待确认
                          <span>账户额度</span>
                        </span>
                      ) : unlimited ? (
                        <span className="pt-percent">不限额度</span>
                      ) : hasAccountBalance ? (
                        <span className="pt-percent">
                          {money(provider.accountBalance ?? 0)}
                          <span>账户余额</span>
                        </span>
                      ) : (
                        <span className="pt-usage-metric">
                          <span className="pt-percent">
                            {formatPercent(remaining)}
                          </span>
                          {codexActive && <CodexLiveBadge />}
                        </span>
                      )}
                      <span className="pt-remaining">
                        {needsLogin
                          ? '登录后读取'
                          : noData
                            ? '—'
                          : unknown
                            ? `累计 ${money(cumulative)}`
                          : hasAccountBalance
                            ? `累计已用 ${money(cumulative)}`
                            : provider.billing === 'quota'
                              ? `剩余 ${formatQuota(quota.available, provider)}`
                              : `余额 ${money(provider.balance)}`}
                      </span>
                    </div>
                    {needsLogin ? (
                      <div
                        className="unlimited-bar is-login pt-unlimited-bar"
                        aria-hidden="true"
                      >
                        <span />
                      </div>
                    ) : noData ? (
                      <div
                        className="unlimited-bar is-error pt-unlimited-bar"
                        aria-hidden="true"
                      >
                        <span />
                      </div>
                    ) : unknown ? (
                      <div
                        className="unlimited-bar is-unknown pt-unlimited-bar"
                        aria-hidden="true"
                      >
                        <span />
                      </div>
                    ) : hasAccountBalance || unlimited ? (
                      <div className="unlimited-bar pt-unlimited-bar" aria-hidden="true">
                        <span />
                      </div>
                    ) : (
                      <ProgressBar
                        value={remaining}
                        tone={usageTone(quota.percent)}
                        thin
                        label={`${provider.name} 剩余额度${
                codexActive ? '，Codex 正在消耗' : ''
              }`}
                        active={codexActive}
                      />
                    )}
                    <span className="pt-sub">
                      {noData
                        ? '额度接口不可用 · 请到供应商后台查看'
                        : unknown
                          ? 'API Key 不限额 · 账户额度未授权'
                        : hasAccountBalance
                          ? '已授权用户额度查询'
                          : quota.total !== null
                            ? `已用 ${formatQuota(quota.used, provider)} / ${formatQuota(quota.total, provider)}`
                            : `累计已用 ${money(cumulative)}`}
                    </span>
                    {hasPlanQuota && hasAccountBalance && (
                      <span className="pt-wallet-sub">
                        <Icon name="wallet" size={11} />
                        钱包余额 {money(provider.accountBalance ?? 0)}
                      </span>
                    )}
                  </div>

                  <div className="pt-status">
                    <StatusBadge status={status} />
                    <span
                      className={cx(
                        'pt-sub',
                        provider.syncError && 'pt-sub-error',
                      )}
                      title={provider.syncError || undefined}
                    >
                      {!provider.enabled
                        ? '暂停统计'
                        : needsLogin
                          ? `登录 ${loginLabel} 网页读取额度`
                          : provider.syncError
                            ? '同步失败'
                            : expiry ??
                              (unknown
                                ? '账户额度待授权查询'
                                : status === 'exhausted'
                                  ? hasAccountBalance
                                    ? `余额 ${money(provider.accountBalance ?? 0)} · 请充值`
                                    : '额度已耗尽 · 请续费或等待重置'
                                  : status === 'warning'
                                    ? hasAccountBalance
                                      ? `余额 ${money(provider.accountBalance ?? 0)} · 建议充值`
                                      : '额度即将耗尽 · 建议补充'
                                    : synced
                                      ? `接口同步${lastSync ? ` · ${lastSync}` : ''}`
                                      : '额度运行正常')}
                    </span>
                    {needsLogin && (
                      <button
                        type="button"
                        className="text-button pt-login-link"
                        onClick={() => onLogin(provider)}
                        disabled={Boolean(loginBusyId) && loginBusyId === provider.sourceId}
                      >
                        <Icon name="key" size={11} />
                        {loginBusyId === provider.sourceId
                          ? '登录中…'
                          : `登录 ${loginLabel}`}
                      </button>
                    )}
                  </div>

                  <div className="pt-actions">
                    <Switch
                      checked={provider.enabled}
                      onChange={() => onToggle(provider)}
                      label={`${provider.enabled ? '停用' : '启用'} ${provider.name}`}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`编辑 ${provider.name}`}
                      title="编辑供应商"
                      onClick={() => onEdit(provider)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger-hover"
                      aria-label={`删除 ${provider.name}`}
                      title="删除供应商"
                      onClick={() => onDelete(provider)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
