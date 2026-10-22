import { Icon } from '../icons'
import type { Provider } from '../types'
import {
  cx,
  expiryLabel,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuota,
  getQuotaState,
  getStatus,
  isInterfaceSynced,
  loginBrand,
  logoText,
  relativeTime,
  remainingPercent,
  resetLabel,
} from '../utils'
import {
  ProgressBar,
  ProviderLogo,
  StatusBadge,
  TypeChip,
  usageTone,
} from './ui'

export function ProviderCard({
  provider,
  onEdit,
  onLogin,
  loginBusy = false,
}: {
  provider: Provider
  onEdit: (provider: Provider) => void
  onLogin?: (provider: Provider) => void
  loginBusy?: boolean
}) {
  const quota = getQuotaState(provider)
  const remaining = remainingPercent(quota.percent)
  const status = getStatus(provider)
  const expiry = expiryLabel(provider)
  const synced = isInterfaceSynced(provider)
  const needsLogin = Boolean(provider.loginRequired && provider.loginProvider)
  const loginLabel = loginBrand(provider)
  const unknown = Boolean(provider.limitUnknown)
  const hasPlanQuota = quota.percent !== null && quota.total !== null
  const hasWallet = provider.accountBalance !== undefined
  const hasAccountBalance = hasWallet && !hasPlanQuota
  const hasBoth = hasPlanQuota && hasWallet
  const planBased = Boolean(
    synced &&
      quota.percent !== null &&
      (provider.resetAt || provider.syncMode === 'pixellab'),
  )
  const noData = Boolean(
    provider.syncError &&
      provider.quotaTotal <= 0 &&
      provider.accountBalance === undefined &&
      !provider.lifetimeUsed,
  )
  const cumulative = provider.lifetimeUsed ?? quota.used
  const money = (value: number) => formatMoney(value, provider.currency)
  const availableLabel = hasAccountBalance
    ? `余额 ${money(provider.accountBalance ?? 0)}`
    : provider.billing === 'quota'
      ? `剩余 ${formatQuota(quota.available, provider)}`
      : `余额 ${money(provider.balance)}`
  const lastSync = provider.lastSyncedAt
    ? relativeTime(provider.lastSyncedAt)
    : ''

  return (
    <article className={cx('provider-card', !provider.enabled && 'is-disabled')}>
      <div className="pc-top">
        <ProviderLogo
          text={logoText(provider)}
          color={provider.color}
          size="md"
        />
        <div className="pc-identity">
          <div className="pc-name-row">
            <h3>{provider.name}</h3>
            <TypeChip type={provider.type} />
          </div>
          <p className="pc-sub" title={`${provider.vendor} · ${provider.planName}`}>
            {provider.vendor} · {provider.planName}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="pc-usage">
        <div className="pc-usage-head">
          <span className="pc-usage-label">{needsLogin ? '账户额度' : quota.label}</span>
          {needsLogin ? (
            <span className="pc-usage-value" aria-hidden="true">
              —
            </span>
          ) : noData ? (
            <span className="pc-usage-value">
              <strong>读取失败</strong>
              <span className="pc-usage-sep">·</span>
              检查接口或密钥
            </span>
          ) : unknown ? (
            <span className="pc-usage-value">
              <strong>待确认</strong>
              <span className="pc-usage-sep">·</span>
              累计 {money(cumulative)}
            </span>
          ) : hasAccountBalance ? (
            <span className="pc-usage-value">
              <strong>{money(provider.accountBalance ?? 0)}</strong>
              <span className="pc-usage-sep">·</span>
              累计已用 {money(cumulative)}
            </span>
          ) : quota.percent !== null ? (
            <span className="pc-usage-value">
              <strong>{formatPercent(remaining)}</strong>
              <span className="pc-usage-sep">·</span>
              {availableLabel}
            </span>
          ) : (
            <span className="pc-usage-value">{availableLabel}</span>
          )}
        </div>

        {needsLogin ? (
          <>
            <div className="unlimited-bar is-login" aria-hidden="true">
              <span />
            </div>
            <div className="pc-usage-meta">
              <span>登录态未连接</span>
              <span>网页登录后自动同步</span>
            </div>
          </>
        ) : noData ? (
          <>
            <div className="unlimited-bar is-error" aria-hidden="true">
              <span />
            </div>
            <div className="pc-usage-meta">
              <span>额度接口不可用</span>
              <span>仅同步了配置</span>
            </div>
          </>
        ) : unknown ? (
          <>
            <div className="unlimited-bar is-unknown" aria-hidden="true">
              <span />
            </div>
            <div className="pc-usage-meta">
              <span>API Key 不限额</span>
              <span>账户额度未授权查询</span>
            </div>
          </>
        ) : hasAccountBalance ? (
          <>
            <div className="unlimited-bar" aria-hidden="true">
              <span />
            </div>
            <div className="pc-usage-meta">
              <span>账户余额 {money(provider.accountBalance ?? 0)}</span>
              <span>已授权用户额度查询</span>
            </div>
          </>
        ) : quota.percent !== null ? (
          <>
            <ProgressBar
              value={remaining}
              tone={usageTone(quota.percent)}
              label={`${provider.name} 剩余额度`}
            />
            <div className="pc-usage-meta">
              <span>
                {planBased
                  ? '本周期已用'
                  : synced
                    ? '累计已用'
                    : provider.billing === 'quota'
                      ? '已用'
                      : '本月已用'}{' '}
                {formatQuota(quota.used, provider)}
              </span>
              <span>
                {provider.billing === 'quota'
                  ? `${planBased ? '周期额度' : synced ? '账户总额' : '总量'} ${formatQuota(quota.total ?? 0, provider)}`
                  : `预算 ${money(quota.total ?? 0)}`}
              </span>
            </div>
          </>
        ) : (
          <div className="pc-usage-meta pc-usage-meta-single">
            <span>未设置月度预算，仅展示账户可用余额</span>
          </div>
        )}

        {hasBoth && (
          <div className="pc-wallet-row">
            <span>
              <Icon name="wallet" size={12} />
              钱包余额
            </span>
            <strong>{money(provider.accountBalance ?? 0)}</strong>
          </div>
        )}
      </div>

      {needsLogin && (
        <div className="pc-login-bar">
          <span className="pc-login-copy">
            <Icon name="key" size={13} />
            需要登录 {loginLabel} 网页读取额度
          </span>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => onLogin?.(provider)}
            disabled={loginBusy || !onLogin}
          >
            <Icon name="key" size={12} />
            {loginBusy ? '登录中…' : `登录 ${loginLabel}`}
          </button>
        </div>
      )}

      <div className="pc-foot">
        {synced ? (
          <>
            {planBased && (
              <span className="pc-meta" title="周期额度按供应商接口重置时间计算">
                <Icon name="clock" size={13} />
                {resetLabel(provider)}
              </span>
            )}
            <span className="pc-meta">
              <Icon name="refresh" size={13} />
              {lastSync ? `${lastSync}同步` : '等待首次同步'}
            </span>
            {provider.modelCount ? (
              <span className="pc-meta">
                <Icon name="layers" size={13} />
                {provider.modelCount} 个模型
              </span>
            ) : null}
            {provider.syncError && (
              <span className="pc-sync-error" title={provider.syncError}>
                同步失败
              </span>
            )}
            {expiry && <span className="pc-expiry">{expiry}</span>}
          </>
        ) : (
          <>
            <span
              className="pc-meta"
              title={provider.resetAt ? '重置日期为手动录入' : undefined}
            >
              <Icon name="clock" size={13} />
              {resetLabel(provider)}
            </span>
            <span className="pc-meta">
              <Icon name="zap" size={13} />
              今日 {formatNumber(provider.callsToday)} 次
            </span>
            {expiry && (
              <span className="pc-expiry" title="套餐到期时间">
                {expiry}
              </span>
            )}
          </>
        )}
        <button
          type="button"
          className="text-button pc-manage"
          onClick={() => onEdit(provider)}
          aria-label={`管理 ${provider.name}`}
        >
          管理
          <Icon name="arrow-up-right" size={12} />
        </button>
      </div>
    </article>
  )
}
