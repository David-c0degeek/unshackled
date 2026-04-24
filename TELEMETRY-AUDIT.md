# Telemetry Audit

## Original Findings

### 1. Telemetry Still Present Despite "All Telemetry Stripped" Claims

| Component | Details |
|---|---|
| **GrowthBook SDK** | Full client initialized with user attributes (device ID, session ID, platform, org, email, subscription type, rate limit tier, first token time, GitHub metadata). Sends to `api.anthropic.com`. Periodic refresh every 6h (20min for ant users). |
| **GrowthBook disk cache** | Writes `cachedGrowthBookFeatures` to `~/.claude.json` — survives across process restarts. |
| **1P event logging** | `src/services/analytics/firstPartyEventLoggingExporter.ts` — 780 lines of full exporter with batched HTTP POST to `/api/event_logging/batch`, quadratic backoff retry, disk persistence, and auth fallback. |
| **OTel SDKs** | 15+ `@opentelemetry/*` packages in `package.json` (traces, logs, metrics, multiple exporters: gRPC, HTTP, proto, Prometheus). |
| **Telemetry killswitch** | `src/services/analytics/sinkKillswitch.ts` — Named `tengu_frond_boric`, controls `datadog` and `firstParty` sinks individually. |
| **Privacy control** | `DISABLE_TELEMETRY`, `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` env vars. |
| **Feedback surveys** | `src/components/FeedbackSurvey/` — Three survey hooks (post-compact, memory, generic). |
| **Auth telemetry** | Logs events like `tengu_api_key_saved_to_keychain`, `tengu_oauth_tokens_saved`, `tengu_oauth_token_refresh_*`. |
| **User data collected** | device ID, session ID, email, org UUID, account UUID, subscription type, rate limit tier, platform, app version, GitHub actions metadata, API base URL host. |

### 2. Network Calls to api.anthropic.com

| Endpoint | Trigger | Data Sent |
|---|---|---|
| `/api/event_logging/batch` | Every session event | Full event payload with user attributes |
| `/api/claude_code/policy_limits` | On startup + hourly polling | Policy restrictions for org admin controls |
| `/api/claude_code/remote_settings` | On startup + hourly polling | Managed settings (env vars, permissions, feature flags) |
| `/api/settings/sync/upload` | Interactive CLI sessions | Local settings (env vars, skills, MCP config, memory files) |
| GrowthBook feature fetch | On init + every 6 hours | Feature values, experiments, user attributes |

### 3. Initialization Paths

All of these fire at CLI startup or during auth changes:

- `main.tsx:957-958` — `loadRemoteManagedSettings()`, `loadPolicyLimits()`
- `main.tsx:963-964` — `uploadUserSettingsInBackground()` (conditional on feature flag)
- `interactiveHelpers.tsx:150` — `initializeGrowthBook()` (after trust dialog)
- `cli/print.ts:565` — `initializeGrowthBook()` (headless mode)
- `commands/login/login.tsx:36` — `refreshGrowthBookAfterAuthChange()`, `refreshRemoteManagedSettings()`, `refreshPolicyLimits()`
- `commands/logout/logout.tsx:60` — `refreshGrowthBookAfterAuthChange()`

### 4. Limitations

- No outbound telemetry in OSS build (logEvent/logEventAsync are no-ops)
- No crash reporting (Sentry stripped)
- 67+ third-party providers unsupported (only 5 configured)
- Windows support is WSL-only
- 34 broken feature flags
- Bun-only runtime
- Policy limits only for Team/Enterprise users
- Context compression is aggressive (6+ compact services)

### 5. Censoring / Guardrails

- System prompt injections in `src/constants/prompts.ts`
- Usage policy refusals (stopReason: 'refusal')
- Prompt too long handling
- PDF/image size limits
- Model availability gates (Pro plan blocked from Opus)
- Custom off-switch (Opus → Sonnet redirect)
- Rate limit messages
- Enterprise policy restrictions (allow_remote_sessions, allow_product_feedback)
- Third-party provider filtering (provider-managed env vars)
- Security prompt injection checks (apiKeyHelper, awsAuthRefresh, etc.)

---

## Changes Made to Remove Telemetry

### `src/services/analytics/growthbook.ts`

**`isGrowthBookEnabled()`** — Changed from `return is1PEventLoggingEnabled()` to `return true`. Feature flags still work from disk cache.

**`getGrowthBookClient`** — Skips HTTP `init()` entirely. Returns `{ client: thisClient, initialized: Promise.resolve() }` immediately. All feature values come from `getFeatureValue_CACHED_MAY_BE_STALE`'s disk cache fallback.

**`initializeGrowthBook`** — Skips `setupPeriodicGrowthBookRefresh()`. No more 6-hour network re-fetch.

**`refreshGrowthBookAfterAuthChange()`** — No-op. Just calls `resetGrowthBook()` (clears in-memory state) and emits `refresh` to notify subscribers. No network calls.

**`refreshGrowthBookFeatures()`** — No-op. Just emits `refresh` to notify subscribers.

**`setupPeriodicGrowthBookRefresh()`** — No-op. Removed setInterval that would fire every 6 hours.

**Added `clearGrowthBookCache()`** — New export for `/clear` command to reset all in-memory state.

### `src/services/analytics/firstPartyEventLoggingExporter.ts`

Reduced from **780 lines** to **30 lines**. All methods are no-ops:
- `constructor()` — no background retry of previous batches
- `export()` — immediately calls callback with SUCCESS
- `shutdown()` — no-op
- `destroy()` — no-op

### `src/services/remoteManagedSettings/index.ts`

**`loadRemoteManagedSettings()`** — No-op. Resolves loading promise immediately. Skips `fetchAndLoadRemoteManagedSettings()` network call.

**`refreshRemoteManagedSettings()`** — No-op. Just calls `settingsChangeDetector.notifyChange('policySettings')` so listeners re-read from local config.

**`fetchAndLoadRemoteManagedSettings()`** — Returns `null` immediately. All settings come from local `settings.json`.

**`startBackgroundPolling()`** — No-op. Removed setInterval that would poll every hour.

### `src/services/policyLimits/index.ts`

**`loadPolicyLimits()`** — No-op. Resolves loading promise immediately. Skips `fetchAndLoadPolicyLimits()` network call.

**`refreshPolicyLimits()`** — No-op. All policies default to allowed (fail open).

**`fetchAndLoadPolicyLimits()`** — Returns `null` immediately. All restrictions default to allowed.

**`startBackgroundPolling()`** — No-op. Removed setInterval that would poll every hour.

### `src/commands/login/login.tsx`

Removed post-login API calls:
- `refreshRemoteManagedSettings()` — replaced with comment
- `refreshPolicyLimits()` — replaced with comment

### `src/main.tsx`

Replaced startup API calls:
- `loadRemoteManagedSettings()` → no-op comment
- `loadPolicyLimits()` → no-op comment
- `uploadUserSettingsInBackground()` → no-op comment

### `src/commands/clear/caches.ts`

Added `clearGrowthBookCache()` call in `clearSessionCaches()` to reset all in-memory GrowthBook state on `/clear`.

---

## What's Still in the Binary (But Does Nothing)

| Module | Size | Status |
|---|---|---|
| All OTel SDKs (15+ packages) | ~3 MB | Not initialized |
| `FirstPartyEventLoggingExporter` | 780 lines → 30 lines | All methods no-ops |
| GrowthBook client | ~200 lines | Created but never calls network |
| `fetchAndLoadRemoteManagedSettings` | ~80 lines | Returns null immediately |
| `fetchAndLoadPolicyLimits` | ~70 lines | Returns null immediately |
| `fetchWithRetry` functions | ~40 lines each | Never called from no-op callers |

## What Still Works

- All feature flags work from disk cache (`~/.claude.json` → `cachedGrowthBookFeatures`)
- `/login` and `/logout` still refresh local state
- `/clear` and `/compact` still clear all caches
- Local settings (settings.json, claude.md, skills, MCP) all work normally
- All 54 experimental feature flags remain unlocked
- Model provider selection (Anthropic, OpenAI, Bedrock, Vertex, Foundry) unchanged
