/**
 * 本地账号体系
 *
 * 这个构建没有服务端：账号、会话都只存在当前浏览器的 localStorage 里。
 * 管理员凭据随前端包一起发布，因此这里不构成真正的安全边界——密码只做
 * 摘要后存储，避免明文躺在 DevTools 里，但不要把它当成线上认证方案。
 */

export type AccountRole = 'admin' | 'member'

export interface Account {
  id: string
  username: string
  displayName: string
  role: AccountRole
  passwordHash: string
  createdAt: string
  lastLoginAt?: string
}

export interface AccountInput {
  username: string
  password: string
  displayName?: string
}

export type CreateAccountResult =
  | { ok: true; account: Account }
  | { ok: false; error: string }

const ACCOUNTS_KEY = 'aihub.accounts.v1'
const SESSION_KEY = 'aihub.session.v2'

const ADMIN_USERNAME = 'easonzhou'
const ADMIN_PASSWORD = 'bob215921'
const ADMIN_DISPLAY_NAME = 'Eason'

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,20}$/
const MIN_PASSWORD_LENGTH = 6

/** FNV-1a + 一点加盐混淆，输出 16 位十六进制。仅用于避免明文落盘。 */
export function hashPassword(password: string) {
  const salted = `aihub::${password}::v1`
  let h1 = 0x811c9dc5
  let h2 = 0xc2b2ae35
  for (let i = 0; i < salted.length; i += 1) {
    const code = salted.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= code + i
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Account>
  return (
    typeof item.id === 'string' &&
    typeof item.username === 'string' &&
    typeof item.displayName === 'string' &&
    typeof item.passwordHash === 'string' &&
    typeof item.createdAt === 'string' &&
    (item.role === 'admin' || item.role === 'member')
  )
}

function readAccounts(): Account[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isAccount) : []
  } catch {
    return []
  }
}

function writeAccounts(accounts: Account[]) {
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // 隐私模式下写入可能失败，界面仍可继续用当前内存状态。
  }
}

function nowIso() {
  return new Date().toISOString()
}

function makeId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `acc-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  }
}

/** 读取账号列表，并始终把管理员账号同步成代码里的那份凭据。 */
export function getAccounts(): Account[] {
  const stored = readAccounts()
  const adminIndex = stored.findIndex(
    (account) => account.username.toLowerCase() === ADMIN_USERNAME,
  )

  const admin: Account =
    adminIndex >= 0
      ? {
          ...stored[adminIndex],
          role: 'admin',
          displayName: ADMIN_DISPLAY_NAME,
          passwordHash: hashPassword(ADMIN_PASSWORD),
        }
      : {
          id: 'admin-easonzhou',
          username: ADMIN_USERNAME,
          displayName: ADMIN_DISPLAY_NAME,
          role: 'admin',
          passwordHash: hashPassword(ADMIN_PASSWORD),
          createdAt: nowIso(),
        }

  const rest =
    adminIndex >= 0
      ? stored.filter((_, index) => index !== adminIndex)
      : stored
  const members = rest.filter((account) => account.role === 'member')
  const next = [admin, ...members]

  const changed =
    adminIndex < 0 ||
    stored.length !== next.length ||
    JSON.stringify(stored) !== JSON.stringify(next)
  if (changed) writeAccounts(next)

  return next
}

export function authenticate(username: string, password: string): Account | null {
  const normalized = username.trim().toLowerCase()
  if (!normalized || !password) return null

  const accounts = getAccounts()
  const account = accounts.find(
    (item) => item.username.toLowerCase() === normalized,
  )
  if (!account || account.passwordHash !== hashPassword(password)) return null

  const stamped: Account = { ...account, lastLoginAt: nowIso() }
  writeAccounts(
    accounts.map((item) => (item.id === account.id ? stamped : item)),
  )
  return stamped
}

export function createAccount(input: AccountInput): CreateAccountResult {
  const username = input.username.trim()
  const password = input.password
  const displayName = input.displayName?.trim() || username

  if (!username) return { ok: false, error: '请输入用户名' }
  if (username.toLowerCase() === ADMIN_USERNAME) {
    return { ok: false, error: '该用户名是管理员保留账号' }
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error: '用户名需 3–20 位，只能用字母、数字、下划线、点或横线',
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `密码至少 ${MIN_PASSWORD_LENGTH} 位` }
  }

  const accounts = getAccounts()
  if (
    accounts.some(
      (account) => account.username.toLowerCase() === username.toLowerCase(),
    )
  ) {
    return { ok: false, error: '用户名已存在' }
  }

  const account: Account = {
    id: makeId(),
    username,
    displayName,
    role: 'member',
    passwordHash: hashPassword(password),
    createdAt: nowIso(),
  }
  writeAccounts([...accounts, account])
  return { ok: true, account }
}

export function deleteAccount(id: string) {
  const accounts = getAccounts()
  const target = accounts.find((account) => account.id === id)
  if (!target || target.role === 'admin') return false
  writeAccounts(accounts.filter((account) => account.id !== id))
  return true
}

export function loadSession(): Account | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { accountId?: string } | null
    if (!parsed?.accountId) return null
    return (
      getAccounts().find((account) => account.id === parsed.accountId) ?? null
    )
  } catch {
    return null
  }
}

export function saveSession(account: Account) {
  try {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ accountId: account.id, signedInAt: nowIso() }),
    )
  } catch {
    // 忽略：仅影响刷新后是否记住登录状态。
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    // 忽略
  }
}

export const ADMIN_ACCOUNT_USERNAME = ADMIN_USERNAME
