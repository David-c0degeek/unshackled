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

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

// ─── Mock context for development/testing ──────────────────────────────────────

const MOCK_TOOLS: Tools = [
  {
    name: 'Read',
    aliases: [],
    description: 'Read the contents of a file',
    searchHint: 'read file contents',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string' },
      },
    } as any,
    call: async (args: any, ctx: ToolUseContext) => ({
      data: `[Mock Read result for ${args.path}]`,
    }),
    descriptionAsync: async () => 'Read the contents of a file',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    checkPermissions: async () => ({
      behavior: 'allow',
      updatedInput: {},
    }),
    toAutoClassifierInput: () => '',
    userFacingName: () => 'Read',
    renderToolUseMessage: () => null,
    renderToolResultMessage: () => null,
    renderToolUseProgressMessage: () => null,
    mapToolResultToToolResultBlockParam: () => ({
      type: 'text',
      text: '',
    }),
    maxResultSizeChars: 100000,
    prompt: async () => 'Read tool',
  },
  {
    name: 'Edit',
    aliases: [],
    description: 'Edit a file',
    searchHint: 'edit file content',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string' },
        diff: { type: 'string' },
      },
    } as any,
    call: async (args: any, ctx: ToolUseContext) => ({
      data: `[Mock Edit applied to ${args.path}]`,
    }),
    descriptionAsync: async () => 'Edit a file',
    isConcurrencySafe: () => true,
    isReadOnly: () => false,
    isDestructive: () => true,
    checkPermissions: async () => ({
      behavior: 'allow',
      updatedInput: {},
    }),
    toAutoClassifierInput: () => '',
    userFacingName: () => 'Edit',
    renderToolUseMessage: () => null,
    renderToolResultMessage: () => null,
    renderToolUseProgressMessage: () => null,
    mapToolResultToToolResultBlockParam: () => ({
      type: 'text',
      text: '',
    }),
    maxResultSizeChars: 100000,
    prompt: async () => 'Edit tool',
  },
  {
    name: 'Bash',
    aliases: [],
    description: 'Run a shell command',
    searchHint: 'execute shell command',
    inputSchema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string' },
      },
    } as any,
    call: async (args: any, ctx: ToolUseContext) => ({
      data: `[Mock Bash result: ${args.command}]`,
    }),
    descriptionAsync: async () => 'Run a shell command',
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => true,
    checkPermissions: async () => ({
      behavior: 'allow',
      updatedInput: {},
    }),
    toAutoClassifierInput: () => '',
    userFacingName: () => 'Bash',
    renderToolUseMessage: () => null,
    renderToolResultMessage: () => null,
    renderToolUseProgressMessage: () => null,
    mapToolResultToToolResultBlockParam: () => ({
      type: 'text',
      text: '',
    }),
    maxResultSizeChars: 100000,
    prompt: async () => 'Bash tool',
  },
] as any

const MOCK_CONTEXT: ToolUseContext = {
  options: {
    commands: [],
    debug: false,
    mainLoopModel: 'claude-sonnet-4-20250514',
    tools: MOCK_TOOLS,
    verbose: false,
    thinkingConfig: { mode: 'off' } as any,
    mcpClients: [],
    mcpResources: {},
    isNonInteractiveSession: false,
    agentDefinitions: [],
    maxBudgetUsd: 10,
  },
  abortController: new AbortController(),
  readFileState: {
    get: () => ({ content: '', size: 0, mtimeMs: 0 }),
    set: () => {},
    has: () => false,
  } as any,
  getAppState: () => ({}) as any,
  setAppState: () => {},
  setToolJSX: () => {},
  setInProgressToolUseIDs: () => {},
  setResponseLength: () => {},
  messages: [],
} as any

// ─── Mock query execution ──────────────────────────────────────────────────────

/**
 * Simulates a query execution with realistic tool calls and responses.
 * In the future, this will be replaced with actual query.ts integration.
 */
async function executeMockQuery(
  prompt: string,
  context: ToolUseContext,
  callbacks: StreamingCallbacks,
  maxSteps: number,
): Promise<{ messages: Message[]; steps: StepResult[]; textDeltaChars: number }> {
  const messages: Message[] = []
  const steps: StepResult[] = []
  let textDeltaChars = 0

  // Add initial user message
  const userMessage = {
    type: 'user',
    role: 'user' as const,
    content: [{ type: 'text', text: prompt }],
    metadata: {},
  } as any
  messages.push(userMessage)
  callbacks.onMessageAdded?.(userMessage)

  for (let step = 1; step <= maxSteps; step++) {
    const stepDesc = `Step ${step}: Processing...`
    callbacks.onStepStart?.(step, stepDesc)

    // Simulate thinking + tool calls
    const toolCallNames = ['Read', 'Edit', 'Bash']
    const selectedTool = toolCallNames[step % toolCallNames.length]
    const args: Record<string, unknown> = {}

    switch (selectedTool) {
      case 'Read':
        args.path = `src/file${step}.ts`
        break
      case 'Edit':
        args.path = `src/file${step}.ts`
        args.diff = `// Modified in step ${step}`
        break
      case 'Bash':
        args.command = `echo "Step ${step} output"`
        break
    }

    callbacks.onToolCall?.(selectedTool, args)

    // Simulate text response
    const responseText = `Completed step ${step}: ${selectedTool} on ${JSON.stringify(args).substring(0, 50)}...`
    for (const char of responseText) {
      callbacks.onTextDelta?.(char)
      textDeltaChars++
    }

    // Simulate tool result
    callbacks.onToolResult?.(selectedTool, `Success`)

    // Add assistant message
    const assistantMessage = {
      type: 'assistant',
      role: 'assistant' as const,
      content: [{ type: 'text', text: responseText }],
      metadata: {},
    } as any
    messages.push(assistantMessage)
    callbacks.onMessageAdded?.(assistantMessage)

    steps.push({
      step,
      description: stepDesc,
      success: true,
      messagesAdded: 1,
    })

    callbacks.onStepComplete?.(step, true)

    // Check if we should stop (simulated completion condition)
    if (step >= 5) {
      break
    }
  }

  return { messages, steps, textDeltaChars }
}

// ─── Worker implementation ─────────────────────────────────────────────────────

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
      // In real mode, this would call query.ts
      // For now, use mock execution
      const result = await executeMockQuery(
        this.options.prompt,
        MOCK_CONTEXT,
        this.options.callbacks,
        this.options.maxSteps - step + 1,
      )

      // Update messages
      // In real mode: allMessages.push(...result.messages)
      // For mock: we just track the count

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
   * Run all steps sequentially.
   */
  async run(): Promise<WorkerResult> {
    const allMessages: Message[] = []
    const steps: StepResult[] = []

    for (let step = 1; step <= this.options.maxSteps; step++) {
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
