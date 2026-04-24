/**
 * Policy Limits Service
 *
 * Fetches organization-level policy restrictions from the API and uses them
 * to disable CLI features. Follows the same patterns as remote managed settings
 * (fail open, ETag caching, background polling, retry logic).
 *
 * Eligibility:
 * - Console users (API key): All eligible
 * - OAuth users (Claude.ai): Only Team and Enterprise/C4E subscribers are eligible
 * - API fails open (non-blocking) - if fetch fails, continues without restrictions
 * - API returns empty restrictions for users without policy limits
 */

import { createHash } from 'crypto'
import { readFileSync as fsReadFileSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import {
  CLAUDE_AI_INFERENCE_SCOPE,
  getOauthConfig,
  OAUTH_BETA_HEADER,
} from '../../constants/oauth.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { getUnshackledConfigHomeDir } from '../../utils/envUtils.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import {
  type PolicyLimitsResponse,
  PolicyLimitsResponseSchema,
} from './types.js'

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error
}

// Constants
const CACHE_FILENAME = 'policy-limits.json'
const POLLING_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

// Background polling state
let pollingIntervalId: ReturnType<typeof setInterval> | null = null
let cleanupRegistered = false

// Promise that resolves when initial policy limits loading completes
let loadingCompletePromise: Promise<void> | null = null
let loadingCompleteResolve: (() => void) | null = null

// Timeout for the loading promise to prevent deadlocks
const LOADING_PROMISE_TIMEOUT_MS = 30000 // 30 seconds

// Session-level cache for policy restrictions
let sessionCache: PolicyLimitsResponse['restrictions'] | null = null

/**
 * Test-only sync reset. clearPolicyLimitsCache() does file I/O and is too
 * expensive for preload beforeEach; this only clears the module-level
 * singleton so downstream tests in the same shard see a clean slate.
 */
export function _resetPolicyLimitsForTesting(): void {
  stopBackgroundPolling()
  sessionCache = null
  loadingCompletePromise = null
  loadingCompleteResolve = null
}

/**
 * Initialize the loading promise for policy limits
 * This should be called early (e.g., in init.ts) to allow other systems
 * to await policy limits loading even if loadPolicyLimits() hasn't been called yet.
 *
 * Only creates the promise if the user is eligible for policy limits.
 * Includes a timeout to prevent deadlocks if loadPolicyLimits() is never called.
 */
export function initializePolicyLimitsLoadingPromise(): void {
  if (loadingCompletePromise) {
    return
  }

  if (isPolicyLimitsEligible()) {
    loadingCompletePromise = new Promise(resolve => {
      loadingCompleteResolve = resolve

      setTimeout(() => {
        if (loadingCompleteResolve) {
          logForDebugging(
            'Policy limits: Loading promise timed out, resolving anyway',
          )
          loadingCompleteResolve()
          loadingCompleteResolve = null
        }
      }, LOADING_PROMISE_TIMEOUT_MS)
    })
  }
}

/**
 * Get the path to the policy limits cache file
 */
function getCachePath(): string {
  return join(getUnshackledConfigHomeDir(), CACHE_FILENAME)
}

/**
 * Get the policy limits API endpoint
 */
function getPolicyLimitsEndpoint(): string {
  return `${getOauthConfig().BASE_API_URL}/api/claude_code/policy_limits`
}

/**
 * Recursively sort all keys in an object for consistent hashing
 */
function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep)
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      sorted[key] = sortKeysDeep(value)
    }
    return sorted
  }
  return obj
}

/**
 * Compute a checksum from restrictions content for HTTP caching
 */
function computeChecksum(
  restrictions: PolicyLimitsResponse['restrictions'],
): string {
  const sorted = sortKeysDeep(restrictions)
  const normalized = jsonStringify(sorted)
  const hash = createHash('sha256').update(normalized).digest('hex')
  return `sha256:${hash}`
}

/**
 * Check if the current user is eligible for policy limits.
 *
 * IMPORTANT: This function must NOT call getSettings() or any function that calls
 * getSettings() to avoid circular dependencies during settings loading.
 */
export function isPolicyLimitsEligible(): boolean {
  // 3p provider users should not hit the policy limits endpoint
  if (getAPIProvider() !== 'firstParty') {
    return false
  }

  // Custom base URL users should not hit the policy limits endpoint
  if (!isFirstPartyAnthropicBaseUrl()) {
    return false
  }

  // Console users (API key) are eligible if we can get the actual key
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return true
    }
  } catch {
    // No API key available - continue to check OAuth
  }

  // For OAuth users, check if they have Claude.ai tokens
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) {
    return false
  }

  // Must have Claude.ai inference scope
  if (!tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE)) {
    return false
  }

  // Only Team and Enterprise OAuth users are eligible — these orgs have
  // admin-configurable policy restrictions (e.g. allow_remote_sessions)
  if (
    tokens.subscriptionType !== 'enterprise' &&
    tokens.subscriptionType !== 'team'
  ) {
    return false
  }

  return true
}

/**
 * Wait for the initial policy limits loading to complete
 * Returns immediately if user is not eligible or loading has already completed
 */
export async function waitForPolicyLimitsToLoad(): Promise<void> {
  if (loadingCompletePromise) {
    await loadingCompletePromise
  }
}

/**
 * Get auth headers for policy limits without calling getSettings()
 * Supports both API key and OAuth authentication
 */
function getAuthHeaders(): {
  headers: Record<string, string>
  error?: string
} {
  // Try API key first (for Console users)
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
 * Load restrictions from cache file
 */
// sync IO: called from sync context (getRestrictionsFromCache -> isPolicyAllowed)
function loadCachedRestrictions(): PolicyLimitsResponse['restrictions'] | null {
  try {
    const content = fsReadFileSync(getCachePath(), 'utf-8')
    const data = safeParseJSON(content, false)
    const parsed = PolicyLimitsResponseSchema().safeParse(data)
    if (!parsed.success) {
      return null
    }

    return parsed.data.restrictions
  } catch {
    return null
  }
}

/**
 * Fetch and load policy limits with file caching
 *
 * OSS build: no-op — all policies default to allowed.
 */
async function fetchAndLoadPolicyLimits(): Promise<
  PolicyLimitsResponse['restrictions'] | null
> {
  // OSS build: skip network fetch, return null (all policies allowed)
  return null
}

/**
 * Policies that default to denied when essential-traffic-only mode is active
 * and the policy cache is unavailable. Without this, a cache miss or network
 * timeout would silently re-enable these features for HIPAA orgs.
 */
const ESSENTIAL_TRAFFIC_DENY_ON_MISS = new Set(['allow_product_feedback'])

/**
 * Check if a specific policy is allowed
 * Returns true if the policy is unknown, unavailable, or explicitly allowed (fail open).
 * Exception: policies in ESSENTIAL_TRAFFIC_DENY_ON_MISS fail closed when
 * essential-traffic-only mode is active and the cache is unavailable.
 */
export function isPolicyAllowed(policy: string): boolean {
  const restrictions = getRestrictionsFromCache()
  if (!restrictions) {
    if (
      isEssentialTrafficOnly() &&
      ESSENTIAL_TRAFFIC_DENY_ON_MISS.has(policy)
    ) {
      return false
    }
    return true // fail open
  }
  const restriction = restrictions[policy]
  if (!restriction) {
    return true // unknown policy = allowed
  }
  return restriction.allowed
}

/**
 * Get restrictions synchronously from session cache or file
 */
function getRestrictionsFromCache():
  | PolicyLimitsResponse['restrictions']
  | null {
  if (!isPolicyLimitsEligible()) {
    return null
  }

  if (sessionCache) {
    return sessionCache
  }

  const cachedRestrictions = loadCachedRestrictions()
  if (cachedRestrictions) {
    sessionCache = cachedRestrictions
    return cachedRestrictions
  }

  return null
}

/**
 * Load policy limits during CLI initialization
 *
 * OSS build: no-op — all policies default to allowed (fail open).
 */
export async function loadPolicyLimits(): Promise<void> {
  // OSS build: skip network fetch, resolve immediately
  if (loadingCompleteResolve) {
    loadingCompleteResolve()
    loadingCompleteResolve = null
  }
}

/**
 * Refresh policy limits asynchronously (for auth state changes)
 *
 * OSS build: no-op — all policies default to allowed.
 */
export async function refreshPolicyLimits(): Promise<void> {
  // OSS build: skip network fetch
}

/**
 * Clear all policy limits (session, persistent, and stop polling)
 */
export async function clearPolicyLimitsCache(): Promise<void> {
  stopBackgroundPolling()

  sessionCache = null

  loadingCompletePromise = null
  loadingCompleteResolve = null

  try {
    await unlink(getCachePath())
  } catch {
    // Ignore errors (including ENOENT when file doesn't exist)
  }
}

/**
 * Background polling callback
 */
async function pollPolicyLimits(): Promise<void> {
  if (!isPolicyLimitsEligible()) {
    return
  }

  const previousCache = sessionCache ? jsonStringify(sessionCache) : null

  try {
    await fetchAndLoadPolicyLimits()

    const newCache = sessionCache ? jsonStringify(sessionCache) : null
    if (newCache !== previousCache) {
      logForDebugging('Policy limits: Changed during background poll')
    }
  } catch {
    // Don't fail closed for background polling
  }
}

/**
 * Start background polling for policy limits
 *
 * OSS build: no-op — no network polling.
 */
export function startBackgroundPolling(): void {
  // OSS build: skip background polling (no network calls)
}

/**
 * Stop background polling for policy limits
 */
export function stopBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
}
