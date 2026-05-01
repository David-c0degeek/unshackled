import type { ParsedBrief } from './intake.js'
import type { HarnessProgress } from './progress.js'
import { loadProgress, saveProgress, getProgressPath } from './progress.js'
import { getGitStatus, createBranch, switchToBranch, listHarnessBranches } from './git.js'
import { runLLM } from './llm.js'
import { detectTestCommand } from '../../rules/rules.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanStep {
  step: number
  description: string
  expectedOutcome: string
  tools?: string[]
  conditions?: string[]
}

export interface Plan {
  goal: string
  steps: PlanStep[]
  branch?: string
  testCommand?: string
  createdAt: string
}

/**
 * Get the total number of steps in the plan.
 */
export function getStepCount(plan: Plan): number {
  return plan.steps.length
}

/**
 * Check if all steps in the plan are completed.
 */
export function isComplete(plan: Plan): boolean {
  return plan.steps.every((step) => step.step <= (plan as any)._completedSteps)
}

// ─── Prompt templates ─────────────────────────────────────────────────────

const PLAN_GENERATION_PROMPT = `You are a planning assistant for a multi-step coding agent.

Given the following brief, create a detailed plan with sequential steps.

BRIEF: {{BRIEF}}
GOAL: {{GOAL}}
MAX STEPS: {{MAX_STEPS}}

Each step should:
1. Be a single, well-defined task
2. Include a clear description of what to do
3. Include the expected outcome
4. List the tools needed (Read, Edit, Bash, etc.)
5. Include any conditions for success

Format each step as:
- Step {N}: {description}
  Expected: {expected outcome}
  Tools: {list of tools}
  Conditions: {conditions}

Keep the plan concise but detailed enough for an agent to execute each step without ambiguity.
The plan should be achievable within the maximum number of steps.
`;

// ─── Functions ─────────────────────────────────────────────────────────────────

/**
 * Generate a plan for the given brief
 */
export async function generatePlan(
  parsedBrief: ParsedBrief,
  maxSteps: number,
): Promise<Plan> {
  const prompt = PLAN_GENERATION_PROMPT
    .replace('{{BRIEF}}', parsedBrief.brief)
    .replace('{{GOAL}}', parsedBrief.goal)
    .replace('{{MAX_STEPS}}', String(maxSteps))

  const response = await runLLM({
    prompt,
    systemPrompt: `You are a planning assistant. Create detailed, sequential plans for coding tasks.
    Return only the plan, no extra text.`,
  })

  // Parse the response into steps
  const steps = parsePlanResponse(response)

  return {
    goal: parsedBrief.goal,
    steps,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Parse a plan response from the LLM
 */
function parsePlanResponse(response: string): PlanStep[] {
  const lines = response.split('\n')
  const steps: PlanStep[] = []
  let currentStep: PlanStep | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Check if this is a step header
    const stepMatch = trimmed.match(/^Step\s+(\d+):\s+(.+)$/i)
    if (stepMatch) {
      if (currentStep) {
        steps.push(currentStep)
      }
      currentStep = {
        step: parseInt(stepMatch[1], 10),
        description: stepMatch[2],
        expectedOutcome: '',
        tools: [],
        conditions: [],
      }
      continue
    }

    // Parse expected outcome
    const outcomeMatch = trimmed.match(/^Expected:\s+(.+)$/i)
    if (outcomeMatch && currentStep) {
      currentStep.expectedOutcome = outcomeMatch[1]
      continue
    }

    // Parse tools
    const toolsMatch = trimmed.match(/^Tools:\s+(.+)$/i)
    if (toolsMatch && currentStep) {
      currentStep.tools = toolsMatch[1].split(',').map((t) => t.trim())
      continue
    }

    // Parse conditions
    const conditionsMatch = trimmed.match(/^Conditions:\s+(.+)$/i)
    if (conditionsMatch && currentStep) {
      currentStep.conditions = conditionsMatch[1].split(',').map((c) => c.trim())
      continue
    }
  }

  // Don't forget the last step
  if (currentStep) {
    steps.push(currentStep)
  }

  // If no steps were parsed, create a default one
  if (steps.length === 0) {
    return [
      {
        step: 1,
        description: 'Analyze the brief and create a plan',
        expectedOutcome: 'A detailed plan is created',
        tools: ['Read', 'Bash'],
        conditions: ['Plan is valid'],
      },
    ]
  }

  // Re-number steps sequentially
  steps.forEach((step, i) => {
    step.step = i + 1
  })

  return steps
}

/**
 * Resume a plan from saved progress
 */
export async function resumePlan(
  sessionId: string,
  fromStep?: number,
): Promise<Plan> {
  const progress = loadProgress()
  if (!progress) {
    throw new Error('No saved progress found')
  }

  // If we're resuming, we might need to regenerate the plan
  // For now, we'll use the existing steps
  const steps = progress.steps.map((step, i) => ({
    step: i + 1,
    description: step.description,
    expectedOutcome: '',
    tools: [],
    conditions: [],
  }))

  return {
    goal: progress.goal,
    steps,
    createdAt: progress.startedAt,
  }
}

/**
 * Save the current plan to progress
 */
export function savePlanToProgress(plan: Plan, progress: HarnessProgress): void {
  progress.steps = plan.steps.map((step, i) => ({
    step: i + 1,
    description: step.description,
    expectedOutcome: step.expectedOutcome,
    tools: step.tools,
    conditions: step.conditions,
    status: 'pending' as const,
    success: false,
    durationMs: 0,
    error: '',
  }))

  progress.totalSteps = plan.steps.length
  saveProgress(progress)
}

/**
 * Check if the plan needs to be regenerated
 */
export function shouldRegeneratePlan(progress: HarnessProgress): boolean {
  // Regenerate if:
  // 1. No steps are defined
  // 2. All steps are completed (new task)
  // 3. The goal has changed
  return (
    progress.steps.length === 0 ||
    progress.status === 'completed' ||
    progress.status === 'plan-only'
  )
}

/**
 * Update the plan with new steps
 */
export function updatePlan(
  progress: HarnessProgress,
  newSteps: PlanStep[],
): void {
  progress.steps = newSteps.map((step, i) => ({
    step: i + 1,
    description: step.description,
    expectedOutcome: step.expectedOutcome,
    tools: step.tools,
    conditions: step.conditions,
    status: 'pending' as const,
    success: false,
    durationMs: 0,
    error: '',
  }))

  progress.totalSteps = newSteps.length
  saveProgress(progress)
}

/**
 * Get the next step to execute
 */
export function getNextStep(progress: HarnessProgress): PlanStep | null {
  const pendingStep = progress.steps.find((step) => step.status === 'pending')
  if (!pendingStep) {
    return null
  }

  return {
    step: pendingStep.step,
    description: pendingStep.description,
    expectedOutcome: (pendingStep as any).expectedOutcome ?? '',
    tools: (pendingStep as any).tools ?? [],
    conditions: (pendingStep as any).conditions ?? [],
  }
}

/**
 * Mark a step as completed
 */
export function markStepComplete(
  progress: HarnessProgress,
  stepIndex: number,
  success: boolean,
  error?: string,
): void {
  if (stepIndex < 0 || stepIndex >= progress.steps.length) {
    throw new Error(`Invalid step index: ${stepIndex}`)
  }

  const step = progress.steps[stepIndex]
  step.status = success ? 'completed' : 'failed'
  step.success = success
  step.durationMs = Date.now() - new Date(progress.startedAt).getTime()
  if (error) {
    step.error = error
  }

  // Update current step
  progress.currentStep = stepIndex + 1

  // Update overall status
  if (success) {
    // Check if all steps are completed
    const allCompleted = progress.steps.every(
      (s) => s.status === 'completed' || s.status === 'skipped',
    )
    if (allCompleted) {
      progress.status = 'completed'
    }
  } else {
    progress.status = 'failed'
  }

  saveProgress(progress)
}

/**
 * Mark a step as skipped
 */
export function markStepSkipped(
  progress: HarnessProgress,
  stepIndex: number,
  reason?: string,
): void {
  if (stepIndex < 0 || stepIndex >= progress.steps.length) {
    throw new Error(`Invalid step index: ${stepIndex}`)
  }

  const step = progress.steps[stepIndex]
  step.status = 'skipped'
  step.success = true
  step.error = reason ?? 'Skipped'

  // Update current step
  progress.currentStep = stepIndex + 1

  // Check if all steps are completed or skipped
  const allDone = progress.steps.every(
    (s) => s.status === 'completed' || s.status === 'skipped',
  )
  if (allDone) {
    progress.status = 'completed'
  }

  saveProgress(progress)
}
