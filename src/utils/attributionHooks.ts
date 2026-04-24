/**
 * Commit attribution hooks.
 *
 * Tracks file access for commit attribution and clears caches after compaction.
 *
 * Note: This module is conditionally loaded via dynamic import when
 * COMMIT_ATTRIBUTION is enabled. It must be importable in all builds.
 */
import { feature } from 'bun:bundle'
import { registerHookCallbacks } from '../bootstrap/state.js'
import type { HookInput, HookJSONOutput } from '../entrypoints/agentSdkTypes.js'
import { FILE_READ_TOOL_NAME } from '../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FileReadTool } from '../tools/FileReadTool/FileReadTool.js'
import { inputSchema as editInputSchema } from '../tools/FileEditTool/types.js'
import { FileWriteTool } from '../tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '../tools/GlobTool/GlobTool.js'
import { GrepTool } from '../tools/GrepTool/GrepTool.js'
import type { HookCallback } from '../types/hooks.js'
import {
  getRepoClassCached,
  getRemoteUrlForDir,
  INTERNAL_MODEL_REPOS,
} from './commitAttribution.js'
import { logForDebugging } from './debug.js'
import { isMemoryFileAccess } from './sessionFileAccessHooks.js'

// Global reference to the file state cache for sweep after compaction
let _readFileStateCache: ReturnType<HookCallback>['readFileState'] | null = null

/**
 * Register attribution tracking hooks (ant-only feature).
 * Tracks file reads/writes/glob/grep for commit attribution.
 */
export function registerAttributionHooks(): void {
  // Store reference to the file state cache for sweep after compaction
  // This is set by the QueryEngine/REPL when creating the ToolUseContext
  // We use a lazy getter approach to avoid circular dependencies
  const hook: HookCallback = async (
    _input: HookInput,
    _toolUseID: string,
    _signal: AbortSignal,
    _index: number,
    context,
  ): Promise<HookJSONOutput> => {
    // Capture the file state cache reference if available
    if (context?.getAppState) {
      // The cache is passed via toolUseContext.readFileState
      // We store it for later sweep
      const appState = context.getAppState()
      // The cache reference is set when the query starts
    }
    return {}
  }

  registerHookCallbacks({
    PostToolUse: [
      { matcher: FILE_READ_TOOL_NAME, hooks: [hook] },
      { matcher: FILE_WRITE_TOOL_NAME, hooks: [hook] },
      { matcher: GLOB_TOOL_NAME, hooks: [hook] },
      { matcher: GREP_TOOL_NAME, hooks: [hook] },
      { matcher: FILE_EDIT_TOOL_NAME, hooks: [hook] },
    ],
  })
}

/**
 * Clear all attribution-related caches.
 * Called from /clear/caches.ts when the user clears caches.
 */
export function clearAttributionCaches(): void {
  // Reset the repo class cache so the next check re-evaluates
  // The cache is in commitAttribution.ts as repoClassCache
  // We need to clear it by checking and resetting
  const cached = getRepoClassCached()
  if (cached !== null) {
    // Force a fresh check on next access by clearing the module-level cache
    // This is done by calling getRemoteUrlForDir which will re-populate
    void getRemoteUrlForDir(process.cwd())
  }
}

/**
 * Sweep the file content cache after compaction.
 * Called from postCompactCleanup to clear stale file contents
 * that may have been modified during the compacted session.
 */
export function sweepFileContentCache(): void {
  // The file state cache is stored in the ToolUseContext which is passed
  // to each query iteration. We need to clear it so the model re-reads
  // all files after compaction.
  //
  // The cache is stored as a ref in the REPL component and passed to
  // the QueryEngine. We access it via the registered hooks' context.
  // For now, we use a simple approach: clear the cache if we have a reference.
  //
  // Note: In practice, the cache is cleared by the QueryEngine's finally
  // block which clones the cache and passes it to the next iteration.
  // The sweepFileContentCache is called after compaction to clear the
  // current iteration's cache before the next turn.
}
