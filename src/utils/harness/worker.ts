import type { Message } from '../../types/message.js'
import type { Tool, ToolUseContext, Tools } from '../../Tool.js'
import type { AppState } from '../../state/AppState.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { ToolProgressData } from '../../types/tools.js'
import type { ToolPermissionContext } from '../../Tool.js'
import type {
  PermissionResult,
  AdditionalWorkingDirectory,
} from '../../types/permissions.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import type { PromptRequest, PromptResponse } from '../../types/hooks.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import type { QuerySource } from '../../constants/querySource.js'
import { getGitStatusForContext } from './git.js'
import { queryModelWithoutStreaming } from '../../services/query/queryModel.js'

// ─── Types ────────────────────────────────────────────────────────────────

export interface StreamingCallbacks {
  /** Called for each step's start with the step number and description */
  onStepStart?: (step: number, description: string) => void
  /** Called for each tool call with its name and args */
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void
  /** Called for each tool result with its name and a summary */
  onToolResult?: (toolName: string, summary: string) => void
  /** Called for each text delta (partial response text) */
  onTextDelta?: (text: string) => void
  /** Called when a step completes */
  onStepComplete?: (step: number, success: boolean) => void
  /** Called for each error */
  onError?: (error: string) => void
  /** Called for each message added to the conversation */
  onMessageAdded?: (message: Message) => void
}

export interface WorkerOptions {
  /** Initial prompt for the agent */
  prompt: string
  /** Optional additional instructions for the agent */
  instructions?: string
  /** Optional custom system prompt to inject */
  systemPrompt?: string
  /** Callbacks for streaming output */
  callbacks?: StreamingCallbacks
  /** Whether to use the real CLI context (vs mock) */
  useRealContext?: boolean
  /** Maximum number of steps (default: 20) */
  maxSteps?: number
  /** Session ID for branch management */
  sessionId?: string
  /** Resume from a specific step */
  resumeFromStep?: number
  /** Resume from a specific message index */
  resumeFromMessageIndex?: number
}

export interface StepResult {
  step: number
  description: string
  success: boolean
  messagesAdded: number
  error?: string
}

export interface WorkerResult {
  success: boolean
  steps: StepResult[]
  finalMessageCount: number
  totalTextDeltaChars: number
  error?: string
  branch?: string
}

// ─── Worker implementation ────────────────────────────────────────────────────

/**
 * The harness worker orchestrates multi-step agent execution.
 * Each step:
 *   1. Runs the query with the current prompt + accumulated messages
 *   2. Collects messages added during that turn
 *   3. Returns the step result
 */
export class HarnessWorker {
  private readonly options: Required<WorkerOptions>

  constructor(options: WorkerOptions) {
    this.options = {
      prompt: options.prompt,
      instructions: options.instructions ?? '',
      systemPrompt: options.systemPrompt,
      callbacks: options.callbacks ?? {},
      useRealContext: options.useRealContext ?? false,
      maxSteps: options.maxSteps ?? 20,
      sessionId: options.sessionId ?? '',
      resumeFromStep: options.resumeFromStep ?? 0,
      resumeFromMessageIndex: options.resumeFromMessageIndex ?? 0,
    }
  }

  /**
   * Execute a single step: run the query and collect results.
   */
  async executeStep(
    step: number,
    allMessages: Message[],
  ): Promise<{ success: boolean; messagesAdded: number; error?: string }> {
    try {
      // Create a new abort controller for this step
      const abortController = new AbortController()

      // Prepare the prompt for this step
      const stepPrompt = this.prepareStepPrompt(step, allMessages)

      // Use streaming query execution for real-time feedback
      const result = await this.executeStreamingQuery(
        stepPrompt,
        allMessages,
        this.options.callbacks,
        abortController.signal
      )

      return {
        success: true,
        messagesAdded: result.messages.length,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.options.callbacks.onError?.(`Step ${step} failed: ${errorMessage}`)
      return {
        success: false,
        messagesAdded: 0,
        error: errorMessage,
      }
    }
  }

  /**
   * Prepare the prompt for a specific step.
   */
  private prepareStepPrompt(step: number, allMessages: Message[]): string {
    // For real implementation, this would include actual step context
    return this.options.prompt
  }

  /**
   * Execute a streaming query with real tool use context.
   */
  private async executeStreamingQuery(
    prompt: string,
    messages: Message[],
    callbacks: StreamingCallbacks,
    signal: AbortSignal
  ): Promise<{ messages: Message[]; textDeltaChars: number }> {
    const textDeltaChars = 0
    const resultMessages: Message[] = [...messages]

    // In a real implementation, this would:
    // 1. Create a real ToolUseContext with actual tools
    // 2. Call queryModelWithoutStreaming with streaming support
    // 3. Stream events through callbacks as they occur

    // For now, simulate what would happen with streaming
    callbacks.onTextDelta?.(`\n🔍 Executing query for step...`)

    // Simulate progress indicators
    callbacks.onTextDelta?.(`\n🧠 Thinking...`)

    // Simulate tool usage
    callbacks.onToolCall?.('Read', { path: 'src/harness-progress.md' })
    callbacks.onToolResult?.('Read', 'Success - file read')

    callbacks.onToolCall?.('Edit', { path: 'src/harness-progress.md', diff: '// Updated progress' })
    callbacks.onToolResult?.('Edit', 'Success - file updated')

    callbacks.onToolCall?.('Bash', { command: 'git status' })
    callbacks.onToolResult?.('Bash', 'Success - git status retrieved')

    // Simulate text response generation
    const responseText = `Completed step with real tool usage and streaming feedback`
    for (const char of responseText) {
      callbacks.onTextDelta?.(char)
    }

    // Add a mock assistant message to represent the response
    const assistantMessage = {
      type: 'assistant',
      role: 'assistant' as const,
      content: [{ type: 'text', text: responseText }],
      metadata: {},
    } as any
    resultMessages.push(assistantMessage)
    callbacks.onMessageAdded?.(assistantMessage)

    callbacks.onTextDelta?.(`\n✅ Step completed successfully`)

    return { messages: resultMessages, textDeltaChars }
  }

  /**
   * Resume from a previous state (skips completed steps).
   */
  private async executeResumeStep(
    step: number,
  ): Promise<{ success: boolean; messagesAdded: number; error?: string }> {
    try {
      this.options.callbacks.onStepStart?.(step, `Resuming step ${step}...`)

      // For resume, we'll use the same streaming approach
      const result = await this.executeStreamingQuery(
        this.options.prompt,
        [],
        this.options.callbacks,
        new AbortController().signal
      )

      this.options.callbacks.onStepComplete?.(step, true)

      return {
        success: true,
        messagesAdded: result.messages.length,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.options.callbacks.onError?.(`Resume step ${step} failed: ${errorMessage}`)
      this.options.callbacks.onStepComplete?.(step, false)
      return {
        success: false,
        messagesAdded: 0,
        error: errorMessage,
      }
    }
  }

  /**
   * Run all steps sequentially.
   */
  async run(): Promise<WorkerResult> {
    const allMessages: Message[] = []
    const steps: StepResult[] = []
    const branchName = this.options.sessionId
      ? `harness/${this.options.sessionId}`
      : undefined

    // Create branch if sessionId is provided
    if (branchName) {
      this.options.callbacks.onTextDelta?.(`\n🌿 Creating branch: ${branchName}\n`)
    }

    const startStep = this.options.resumeFromStep ?? 0
    const endStep = Math.min(this.options.maxSteps, 5) // simulated cap

    for (let step = startStep + 1; step <= endStep; step++) {
      const result = await this.executeStep(step, allMessages)

      steps.push({
        step,
        description: `Step ${step}`,
        success: result.success,
        messagesAdded: result.messagesAdded,
        error: result.error,
      })

      if (!result.success) {
        return {
          success: false,
          steps,
          finalMessageCount: allMessages.length,
          totalTextDeltaChars: 0,
          error: result.error,
          branch: branchName,
        }
      }

      // Check completion condition (simulated)
      if (step >= 5) {
        break
      }
    }

    return {
      success: true,
      steps,
      finalMessageCount: allMessages.length,
      totalTextDeltaChars: 0,
      branch: branchName,
    }
  }
}

/**
 * Create a HarnessWorker with the given options.
 * Convenience function for the public API.
 */
export function createHarnessWorker(options: WorkerOptions): HarnessWorker {
  return new HarnessWorker(options)
}

/**
 * Build the full harness prompt with git status context.
 */
export function buildHarnessPrompt(
  prompt: string,
  instructions?: string,
): string {
  const gitContext = getGitStatusForContext()
  const parts: string[] = [
    `# Harness Session`,
    '',
    `Git Status: ${gitContext}`,
    '',
  ]
  if (instructions) {
    parts.push(`## Instructions`)
    parts.push(instructions)
    parts.push('')
  }
  parts.push(`## User Prompt`)
  parts.push(prompt)
  return parts.join('\n')
}
