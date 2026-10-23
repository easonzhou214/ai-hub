/**
 * 本地账号体系
 *
 * 账号与会话存在 localStorage，并通过 /api/state 同步到服务端状态文件；
 * 服务端不校验身份，所以这里不构成安全边界——密码只做摘要，避免明文躺在
 * DevTools 与 hub-state.json 里，但不要把它当成线上认证方案。
 *
 * 管理员只在「首次运行、本地还没有 admin 记录」时用内置口令引导一次，
 * 之后以存储里的摘要为准（可通过 VITE_ADMIN_BOOTSTRAP_PASSWORD 覆盖引导口令）。
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
/** 仅用于首次创建管理员，之后以存储中的摘要为准。 */
const ADMIN_BOOTSTRAP_PASSWORD =
  import.meta.env.VITE_ADMIN_BOOTSTRAP_PASSWORD || 'bob215921'
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

/** 读取账号列表；管理员记录缺失时用引导口令补一条，已有的不覆盖。 */
export function getAccounts(): Account[] {
  const stored = readAccounts()
  const adminIndex = stored.findIndex(
    (account) => account.username.toLowerCase() === ADMIN_USERNAME,
  )

  const admin: Account =
    adminIndex >= 0
      ? // 保留已有摘要：以前每次读取都强制写回内置口令，等于管理员改密码
        // 也无效。现在只有缺记录时才用引导口令创建。
        {
          ...stored[adminIndex],
          role: 'admin',
          displayName: ADMIN_DISPLAY_NAME,
        }
      : {
          id: 'admin-easonzhou',
          username: ADMIN_USERNAME,
          displayName: ADMIN_DISPLAY_NAME,
          role: 'admin',
          passwordHash: hashPassword(ADMIN_BOOTSTRAP_PASSWORD),
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

/**
 * 用服务端返回的账号列表覆盖本地副本。
 *
 * 用于多设备同步：另一台机器新增/删除账号后，这边拉到的列表会覆盖本地。
 * 非法条目直接丢弃；管理员账号由 getAccounts() 兜底补齐。
 */
export function replaceAccounts(input: unknown[]) {
  const accounts = input.filter(isAccount)
  if (!accounts.length) return
  writeAccounts(accounts)
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

export function changePassword(
  accountId: string,
  currentPassword: string,
  nextPassword: string,
): string | null {
  const accounts = getAccounts()
  const account = accounts.find((item) => item.id === accountId)
  if (!account) return '账号不存在'
  if (account.passwordHash !== hashPassword(currentPassword)) {
    return '当前密码不正确'
  }
  if (nextPassword.length < MIN_PASSWORD_LENGTH) {
    return `新密码至少 ${MIN_PASSWORD_LENGTH} 位`
  }
  if (nextPassword === currentPassword) return '新密码不能与当前密码相同'
  writeAccounts(
    accounts.map((item) =>
      item.id === accountId
        ? { ...item, passwordHash: hashPassword(nextPassword) }
        : item,
    ),
  )
  return null
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
