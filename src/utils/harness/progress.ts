import path from 'path'
import fs from 'fs'

const HARNESS_DIR = '.free-code'
const PROGRESS_FILE = 'progress.json'
const SESSIONS_DIR = 'sessions'

// ─── Paths ────────────────────────────────────────────────────────────────

export function getHarnessDir(): string {
  return path.join(process.cwd(), HARNESS_DIR)
}

export function getProgressPath(): string {
  return path.join(getHarnessDir(), PROGRESS_FILE)
}

export function getSessionsDir(): string {
  return path.join(getHarnessDir(), SESSIONS_DIR)
}

export function getSessionProgressPath(sessionId: string): string {
  return path.join(getSessionsDir(), sessionId, PROGRESS_FILE)
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface ProgressStep {
  step: number
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  success: boolean
  durationMs: number
  error: string
}

export interface HarnessProgress {
  sessionId: string
  brief: string
  goal: string
  instructions: string
  systemPrompt?: string
  status: 'running' | 'completed' | 'paused' | 'failed' | 'stopped' | 'plan-only'
  currentStep: number
  totalSteps: number
  steps: ProgressStep[]
  errors: string[]
  maxSteps: number
  branch: string | null
  startedAt: string
  completedAt?: string
  pausedAt?: string
  pausedBy?: string
  pausedAtStep?: number
  stoppedAt?: string
}

// ─── Persistence ──────────────────────────────────────────────────────────

/**
 * Atomically save progress to both global and session-specific locations.
 * Writes to a temp file first, then renames to prevent partial writes.
 */
export function saveProgress(progress: HarnessProgress): void {
  const globalPath = getProgressPath()
  const sessionDir = path.join(getSessionsDir(), progress.sessionId)
  const sessionPath = path.join(sessionDir, PROGRESS_FILE)

  const serialized = JSON.stringify(progress, null, 2)

  // Write global progress atomically
  fs.mkdirSync(path.dirname(globalPath), { recursive: true })
  const globalTemp = globalPath + '.tmp'
  fs.writeFileSync(globalTemp, serialized, 'utf8')
  fs.renameSync(globalTemp, globalPath)

  // Write session-specific progress atomically
  fs.mkdirSync(sessionDir, { recursive: true })
  const sessionTemp = sessionPath + '.tmp'
  fs.writeFileSync(sessionTemp, serialized, 'utf8')
  fs.renameSync(sessionTemp, sessionPath)
}

export function saveProgressRaw(
  path: string,
  data: HarnessProgress,
): void {
  const serialized = JSON.stringify(data, null, 2)
  fs.mkdirSync(path.dirname(path), { recursive: true })
  const temp = path + '.tmp'
  fs.writeFileSync(temp, serialized, 'utf8')
  fs.renameSync(temp, path)
}

/**
 * Load global progress (convenience method for status/plan commands).
 */
export function loadProgress(): HarnessProgress | null {
  const progressPath = getProgressPath()
  try {
    if (!fs.existsSync(progressPath)) {
      return null
    }
    const data = fs.readFileSync(progressPath, 'utf8')
    return JSON.parse(data) as HarnessProgress
  } catch {
    return null
  }
}

/**
 * Load progress for a specific session by session ID.
 */
export function loadSessionProgress(sessionId: string): HarnessProgress | null {
  const sessionPath = getSessionProgressPath(sessionId)
  try {
    if (!fs.existsSync(sessionPath)) {
      return null
    }
    const data = fs.readFileSync(sessionPath, 'utf8')
    return JSON.parse(data) as HarnessProgress
  } catch {
    return null
  }
}

/**
 * Load progress from a raw file path (used by list command).
 */
export function loadProgressFromPath(filePath: string): HarnessProgress | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const data = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(data) as HarnessProgress
  } catch {
    return null
  }
}

/**
 * Format progress as a human-readable string.
 */
export function formatProgress(progress: HarnessProgress): string {
  const lines: string[] = []
  lines.push(`## Harness Progress (${progress.sessionId})`)
  lines.push('')
  lines.push(`**Goal:** ${progress.goal}`)
  lines.push(`**Status:** ${progress.status}`)
  lines.push(`**Started:** ${new Date(progress.startedAt).toLocaleString()}`)
  lines.push(`**Current Step:** ${progress.currentStep}/${progress.totalSteps}`)
  lines.push('')

  if (progress.steps.length > 0) {
    lines.push('### Steps')
    for (const step of progress.steps) {
      const statusIcon =
        step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏳'
      lines.push(`${statusIcon} **Step ${step.step}:** ${step.description}`)
      if (step.error) {
        lines.push(`  - Error: ${step.error}`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Check if all steps in the progress are completed.
 */
export function isComplete(progress: HarnessProgress): boolean {
  return progress.status === 'completed' || progress.status === 'plan-only'
}

/**
 * Load all sessions and return their progress objects.
 */
export function loadAllSessions(): Record<string, HarnessProgress> {
  const sessionsDir = getSessionsDir()
  const result: Record<string, HarnessProgress> = {}

  if (!fs.existsSync(sessionsDir)) {
    return result
  }

  const sessions = fs.readdirSync(sessionsDir)
  for (const sessionId of sessions) {
    const progress = loadSessionProgress(sessionId)
    if (progress) {
      result[sessionId] = progress
    }
  }

  return result
}

// ─── State Mutators ───────────────────────────────────────────────────────

export function updateStepStatus(
  progress: HarnessProgress,
  stepIndex: number,
  status: ProgressStep['status'],
  error?: string,
): void {
  if (stepIndex < 0 || stepIndex >= progress.steps.length) {
    return
  }

  const step = progress.steps[stepIndex]

  // Only increment currentStep if we're moving to a new step
  // (i.e., the currentStep was behind the step we're updating)
  const wasBehind = progress.currentStep <= stepIndex
  progress.currentStep = Math.max(progress.currentStep, stepIndex + 1)

  step.status = status
  step.success = status === 'completed'
  if (error) {
    step.error = error
  }

  // Auto-save to keep state consistent
  saveProgress(progress)
}

export function pauseSession(
  progress: HarnessProgress,
  reason: string,
): void {
  progress.status = 'paused'
  progress.pausedAt = new Date().toISOString()
  progress.pausedBy = reason
  progress.pausedAtStep = progress.currentStep
  saveProgress(progress)
}

export function resumeSession(progress: HarnessProgress): void {
  progress.status = 'running'
  progress.pausedAt = undefined
  progress.pausedBy = undefined
  progress.pausedAtStep = undefined
  saveProgress(progress)
}

export function stopSession(progress: HarnessProgress): void {
  progress.status = 'stopped'
  progress.stoppedAt = new Date().toISOString()
  saveProgress(progress)
}

export function addError(progress: HarnessProgress, error: string): void {
  progress.errors.push(error)
  saveProgress(progress)
}

export function completeSession(progress: HarnessProgress): void {
  progress.status = 'completed'
  progress.completedAt = new Date().toISOString()
  saveProgress(progress)
}
