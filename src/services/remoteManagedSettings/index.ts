/**
 * Remote Managed Settings Service
 *
 * Manages fetching, caching, and validation of remote-managed settings
 * for enterprise customers. Uses checksum-based validation to minimize
 * network traffic and provides graceful degradation on failures.
 *
 * Eligibility:
 * - Console users (API key): All eligible
 * - OAuth users (Claude.ai): Only Enterprise/C4E and Team subscribers are eligible
 * - API fails open (non-blocking) - if fetch fails, continues without remote settings
 * - API returns empty settings for users without managed settings
 */

import { createHash } from 'crypto'
import { unlink } from 'fs/promises'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  type SettingsJson,
} from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import {
  checkManagedSettingsSecurity,
  handleSecurityCheckResult,
} from './securityCheck.jsx'
import { isRemoteManagedSettingsEligible, resetSyncCache } from './syncCache.js'
import {
  getRemoteManagedSettingsSyncFromCache,
  getSettingsPath,
  setSessionCache,
} from './syncCacheState.js'

// Constants
const POLLING_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

// Background polling state
let pollingIntervalId: ReturnType<typeof setInterval> | null = null

// Promise that resolves when initial remote settings loading completes
// This allows other systems to wait for remote settings before initializing
let loadingCompletePromise: Promise<void> | null = null
let loadingCompleteResolve: (() => void) | null = null

// Timeout for the loading promise to prevent deadlocks if loadRemoteManagedSettings() is never called
// (e.g., in Agent SDK tests that don't go through main.tsx)
const LOADING_PROMISE_TIMEOUT_MS = 30000 // 30 seconds

/**
 * Initialize the loading promise for remote managed settings
 * This should be called early (e.g., in init.ts) to allow other systems
 * to await remote settings loading even if loadRemoteManagedSettings()
 * hasn't been called yet.
 *
 * Only creates the promise if the user is eligible for remote settings.
 * Includes a timeout to prevent deadlocks if loadRemoteManagedSettings() is never called.
 */
export function initializeRemoteManagedSettingsLoadingPromise(): void {
  if (loadingCompletePromise) {
    return
  }

  if (isRemoteManagedSettingsEligible()) {
    loadingCompletePromise = new Promise(resolve => {
      loadingCompleteResolve = resolve

      // Set a timeout to resolve the promise even if loadRemoteManagedSettings() is never called
      // This prevents deadlocks in Agent SDK tests and other non-CLI contexts
      setTimeout(() => {
        if (loadingCompleteResolve) {
          logForDebugging(
            'Remote settings: Loading promise timed out, resolving anyway',
          )
          loadingCompleteResolve()
          loadingCompleteResolve = null
        }
      }, LOADING_PROMISE_TIMEOUT_MS)
    })
  }
}

/**
 * Get the remote settings API endpoint
 * Uses the OAuth config base API URL
 */
function getRemoteManagedSettingsEndpoint() {
  return `${getOauthConfig().BASE_API_URL}/api/claude_code/settings`
}

/**
 * Recursively sort all keys in an object to match Python's json.dumps(sort_keys=True)
 */
function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep)
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep((obj as Record<string, unknown>)[key])
    }
    return sorted
  }
  return obj
}

/**
 * Compute checksum from settings content for HTTP caching
 * Must match server's Python: json.dumps(settings, sort_keys=True, separators=(",", ":"))
 * Exported for testing to verify compatibility with server-side implementation
 */
export function computeChecksumFromSettings(settings: SettingsJson): string {
  const sorted = sortKeysDeep(settings)
  // No spaces after separators to match Python's separators=(",", ":")
  const normalized = jsonStringify(sorted)
  const hash = createHash('sha256').update(normalized).digest('hex')
  return `sha256:${hash}`
}

/**
 * Check if the current user is eligible for remote managed settings
 * This is the public API for other systems to check eligibility
 * Used to determine if they should wait for remote settings to load
 */
export function isEligibleForRemoteManagedSettings(): boolean {
  return isRemoteManagedSettingsEligible()
}

/**
 * Wait for the initial remote settings loading to complete
 * Returns immediately if:
 * - User is not eligible for remote settings
 * - Loading has already completed
 * - Loading was never started
 */
export async function waitForRemoteManagedSettingsToLoad(): Promise<void> {
  if (loadingCompletePromise) {
    await loadingCompletePromise
  }
}

/**
 * Get auth headers for remote settings without calling getSettings()
 * This avoids circular dependencies during settings loading
 * Supports both API key and OAuth authentication
 */
function getRemoteSettingsAuthHeaders(): {
  headers: Record<string, string>
  error?: string
} {
  // Try API key first (for Console users)
  // Skip apiKeyHelper to avoid circular dependency with getSettings()
  // Wrap in try-catch because getAnthropicApiKeyWithSource throws in CI/test environments
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return {
        headers: {
          'x-api-key': apiKey,
        },
      }
    }
  } catch {
    // No API key available - continue to check OAuth
  }

  // Fall back to OAuth tokens (for Claude.ai users)
  const oauthTokens = getClaudeAIOAuthTokens()
  if (oauthTokens?.accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    }
  }

  return {
    headers: {},
    error: 'No authentication available',
  }
}

/**
 * Clear all remote settings (session, persistent, and stop polling)
 */
export async function clearRemoteManagedSettingsCache(): Promise<void> {
  // Stop background polling
  stopBackgroundPolling()

  // Clear session cache
  resetSyncCache()

  // Clear loading promise state
  loadingCompletePromise = null
  loadingCompleteResolve = null

  try {
    const path = getSettingsPath()
    await unlink(path)
  } catch {
    // Ignore errors when clearing file (ENOENT is expected)
  }
}

/**
 * Fetch and load remote settings with file caching
 *
 * OSS build: no-op — all settings come from local config.
 */
async function fetchAndLoadRemoteManagedSettings(): Promise<SettingsJson | null> {
  // OSS build: skip network fetch, return null (use local settings)
  return null
}

/**
/**
 * Load remote settings during CLI initialization
 *
 * OSS build: no-op — all settings come from local config.
 */
export async function loadRemoteManagedSettings(): Promise<void> {
  // OSS build: skip network fetch, resolve immediately
  if (loadingCompleteResolve) {
    loadingCompleteResolve()
    loadingCompleteResolve = null
  }
}

/**
 * Refresh remote settings asynchronously (for auth state changes)
 *
 * OSS build: no-op — all settings come from local config.
 */
export async function refreshRemoteManagedSettings(): Promise<void> {
  // OSS build: skip network fetch, just notify listeners
  settingsChangeDetector.notifyChange('policySettings')
}

/**
 * Background polling callback - fetches settings and triggers hot-reload if changed
 */
async function pollRemoteSettings(): Promise<void> {
  if (!isRemoteManagedSettingsEligible()) {
    return
  }

  // Get current cached settings for comparison
  const prevCache = getRemoteManagedSettingsSyncFromCache()
  const previousSettings = prevCache ? jsonStringify(prevCache) : null

  try {
    await fetchAndLoadRemoteManagedSettings()

    // Check if settings actually changed
    const newCache = getRemoteManagedSettingsSyncFromCache()
    const newSettings = newCache ? jsonStringify(newCache) : null
    if (newSettings !== previousSettings) {
      logForDebugging('Remote settings: Changed during background poll')
      settingsChangeDetector.notifyChange('policySettings')
    }
  } catch {
    // Don't fail closed for background polling - just continue
  }
}

/**
 * Start background polling for remote settings
 *
 * OSS build: no-op — no network polling.
 */
export function startBackgroundPolling(): void {
  // OSS build: skip background polling (no network calls)
}

/**
 * Stop background polling for remote settings
 */
export function stopBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
}
