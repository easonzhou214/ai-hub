import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Sync diagnostics.
 *
 * Quota sync talks to third-party APIs, a headless Chrome profile and, during
 * development, this Vite server (which restarts on config changes). Failures
 * used to be visible only as a 160-character tooltip, with no history. Every
 * attempt is now appended to `~/.ai-hub/logs/sync-YYYY-MM-DD.jsonl`, and the
 * browser can read the tail through the loopback-only `/api/cc-switch/logs`.
 *
 * Never log API keys, cookies or JWTs: `sanitize` strips the common token
 * shapes and messages are truncated.
 */

export interface SyncLogEvent {
  ts: string
  level: 'info' | 'warn' | 'error'
  /** server = local Vite bridge, client = browser-side adapter (PixelLab) */
  layer: 'server' | 'client'
  phase: string
  provider?: string
  sourceId?: string
  attempt?: number
  durationMs?: number
  message: string
  code?: string
  httpStatus?: number
}

export const SYNC_LOG_DIR = join(homedir(), '.ai-hub', 'logs')

const RETENTION_DAYS = 30
const MAX_MESSAGE_LENGTH = 500
const LOG_FILE_PATTERN = /^sync-\d{4}-\d{2}-\d{2}\.jsonl$/

let prepared = false

function dayStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sanitize(value: unknown, maxLength = MAX_MESSAGE_LENGTH) {
  return String(value ?? '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/nb_[A-Za-z0-9_-]{8,}/g, 'nb_***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt-***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function prepareLogDir() {
  if (prepared) return
  prepared = true
  try {
    mkdirSync(SYNC_LOG_DIR, { recursive: true })
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
    for (const name of readdirSync(SYNC_LOG_DIR)) {
      if (!LOG_FILE_PATTERN.test(name)) continue
      const file = join(SYNC_LOG_DIR, name)
      try {
        if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
      } catch {
        // Best effort: an unreadable old log must not break sync.
      }
    }
  } catch {
    // If the log directory is not writable, keep syncing without a log.
  }
}

function consoleLine(entry: SyncLogEvent) {
  const time = new Date(entry.ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const who = entry.provider ?? entry.sourceId ?? 'sync'
  const ms =
    typeof entry.durationMs === 'number' ? ` ${entry.durationMs}ms` : ''
  const tries = entry.attempt && entry.attempt > 1 ? ` try#${entry.attempt}` : ''
  const code = entry.code ? ` (${entry.code})` : ''
  const line = `[sync] ${time} ${who} ${entry.message}${ms}${tries}${code}`
  if (entry.level === 'error') console.warn(line)
  else console.log(line)
}

export function logSyncEvent(
  event: Omit<SyncLogEvent, 'ts'> & { ts?: string },
) {
  prepareLogDir()
  const entry: SyncLogEvent = {
    ...event,
    ts: event.ts ?? new Date().toISOString(),
    message: sanitize(event.message) || 'unknown',
    provider: event.provider ? sanitize(event.provider, 120) : undefined,
    sourceId: event.sourceId ? sanitize(event.sourceId, 120) : undefined,
    code: event.code ? sanitize(event.code, 60) : undefined,
  }

  try {
    const file = join(SYNC_LOG_DIR, `sync-${dayStamp()}.jsonl`)
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Logging is diagnostic only; never fail a sync because of it.
  }

  consoleLine(entry)
}

export function readSyncEvents(limit: number) {
  prepareLogDir()
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200)
  const events: SyncLogEvent[] = []

  try {
    const files = readdirSync(SYNC_LOG_DIR)
      .filter((name) => LOG_FILE_PATTERN.test(name))
      .sort()
      .reverse()

    for (const name of files) {
      let lines: string[]
      try {
        lines = readFileSync(join(SYNC_LOG_DIR, name), 'utf8').split('\n')
      } catch {
        continue
      }

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].trim()
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as Partial<SyncLogEvent>
          if (!parsed.ts || !parsed.message) continue
          events.push({
            ts: String(parsed.ts),
            level:
              parsed.level === 'error' || parsed.level === 'warn'
                ? parsed.level
                : 'info',
            layer: parsed.layer === 'client' ? 'client' : 'server',
            phase: String(parsed.phase ?? 'usage'),
            provider: parsed.provider ? String(parsed.provider) : undefined,
            sourceId: parsed.sourceId ? String(parsed.sourceId) : undefined,
            attempt:
              typeof parsed.attempt === 'number' ? parsed.attempt : undefined,
            durationMs:
              typeof parsed.durationMs === 'number'
                ? parsed.durationMs
                : undefined,
            message: String(parsed.message),
            code: parsed.code ? String(parsed.code) : undefined,
            httpStatus:
              typeof parsed.httpStatus === 'number'
                ? parsed.httpStatus
                : undefined,
          })
        } catch {
          // Ignore a partially written line, e.g. after a hard kill.
        }
        if (events.length >= safeLimit) break
      }
      if (events.length >= safeLimit) break
    }
  } catch {
    // Return whatever was parsed; an empty list is a valid state.
  }

  return { path: SYNC_LOG_DIR, events }
}
