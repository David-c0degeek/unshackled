import { runLLM } from './llm.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedBrief {
  brief: string
  goal: string
  context?: string
  constraints?: string[]
  successCriteria?: string[]
}

export type InputType = 'prompt' | 'brief' | 'progress' | 'branch'

/**
 * Detect whether user input is a prompt, brief, or progress indicator.
 * Priority: prompt > brief > progress.
 */
export function getInputType(input: string): InputType {
  const trimmed = input.trim()
  // If it contains structured sections, treat as brief
  if (/^(goal|context|constraints|success\s*criteria|success\s*criteria):/im.test(trimmed)) {
    return 'brief'
  }
  // If it starts with a step number, treat as progress
  if (/^\d+[\.\)]\s*/m.test(trimmed)) {
    return 'progress'
  }
  // Default: treat as prompt
  return 'prompt'
}

/**
 * Determine if a brief or progress file is stale.
 * A file is stale if:
 * - It was last modified more than 24 hours ago, OR
 * - The git working tree has uncommitted changes since it was last updated.
 */
export function isStale(filePath: string): boolean {
  try {
    const stat = Deno.statSync(filePath)
    const now = Date.now()
    const age = now - stat.mtime!.getTime()
    if (age > 24 * 60 * 60 * 1000) {
      return true
    }
    // Check git status
    const { code, stderr } = Deno.run({
      cmd: ['git', 'diff', '--stat', filePath],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    // If git diff returns non-zero, file doesn't exist or isn't tracked
    if (code !== 0) return true
    return false
  } catch {
    return true
  }
}

// ─── Prompt templates ─────────────────────────────────────────────────────

const BRIEF_PARSING_PROMPT = `You are a requirements analyst. Parse the following user brief into a structured format.

USER BRIEF: "{{BRIEF}}"

Extract:
1. GOAL: The primary objective (one sentence)
2. CONTEXT: Any relevant background information
3. CONSTRAINTS: Technical or business constraints
4. SUCCESS CRITERIA: How to verify the task is complete

Format your response as:
GOAL: {goal}
CONTEXT: {context or "None"}
CONSTRAINTS: {list each on a new line with "- "}
SUCCESS CRITERIA: {list each on a new line with "- "}

Be concise and focus on the essential requirements.
`;

// ─── Functions ─────────────────────────────────────────────────────────────────

/**
 * Parse a user brief into structured components
 */
export function readBrief(brief: string): ParsedBrief {
  // For now, do a simple parse
  // In the future, this will call the LLM for intelligent parsing

  return {
    brief,
    goal: extractGoal(brief),
    context: extractContext(brief),
    constraints: extractConstraints(brief),
    successCriteria: extractSuccessCriteria(brief),
  }
}

/**
 * Parse a brief using the LLM for intelligent extraction
 */
export async function parseBriefWithLLM(brief: string): Promise<ParsedBrief> {
  const prompt = BRIEF_PARSING_PROMPT.replace('{{BRIEF}}', brief)

  const response = await runLLM({
    prompt,
    systemPrompt: `You are a requirements analyst. Parse user briefs into structured format.
    Return only the structured data, no extra text.`,
  })

  return parseLLMResponse(response)
}

/**
 * Extract the goal from a brief
 */
function extractGoal(brief: string): string {
  // Simple extraction: take the first sentence or the whole brief
  const firstSentence = brief.split('.')[0]
  return firstSentence || brief
}

/**
 * Extract context from a brief
 */
function extractContext(brief: string): string | undefined {
  const contextMatch = brief.match(/context[:\s]+(.+)$/i)
  return contextMatch?.[1]
}

/**
 * Extract constraints from a brief
 */
function extractConstraints(brief: string): string[] {
  const constraints: string[] = []

  // Look for "must", "should", "cannot", "no"
  const patterns = [
    /must\s+(.+?)(?:\.|$)/gi,
    /should\s+(.+?)(?:\.|$)/gi,
    /cannot\s+(.+?)(?:\.|$)/gi,
    /no\s+(.+?)(?:\.|$)/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(brief)) !== null) {
      constraints.push(match[1].trim())
    }
  }

  return constraints
}

/**
 * Extract success criteria from a brief
 */
function extractSuccessCriteria(brief: string): string[] {
  const criteria: string[] = []

  // Look for "success", "verify", "test", "check"
  const patterns = [
    /success[:\s]+(.+?)(?:\.|$)/gi,
    /verify\s+(.+?)(?:\.|$/gi,
    /test\s+(.+?)(?:\.|$)/gi,
    /check\s+(.+?)(?:\.|$)/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(brief)) !== null) {
      criteria.push(match[1].trim())
    }
  }

  return criteria
}

/**
 * Parse an LLM response into a ParsedBrief
 */
function parseLLMResponse(response: string): ParsedBrief {
  const lines = response.split('\n')
  const parsed: Partial<ParsedBrief> = {}

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('GOAL:')) {
      parsed.goal = trimmed.replace(/^GOAL:\s*/i, '').trim()
    } else if (trimmed.startsWith('CONTEXT:')) {
      const context = trimmed.replace(/^CONTEXT:\s*/i, '').trim()
      if (context !== 'None') {
        parsed.context = context
      }
    } else if (trimmed.startsWith('- ')) {
      // Could be a constraint or success criterion
      // We'll add it to constraints for now
      if (!parsed.constraints) {
        parsed.constraints = []
      }
      parsed.constraints.push(trimmed.replace(/^-\s*/, ''))
    }
  }

  return {
    brief: '',
    goal: parsed.goal ?? 'Unknown',
    context: parsed.context,
    constraints: parsed.constraints ?? [],
    successCriteria: deepMerge(parsed.successCriteria ?? [], []),
  }
}

/** Deep merge two arrays, keeping unique items from both. */
function deepMerge<T>(a: T[], b: T[]): T[] {
  const set = new Set(a)
  for (const item of b) set.add(item)
  return [...set]
}

/**
 * Format a ParsedBrief as a human-readable string.
 */
export function formatBrief(brief: ParsedBrief): string {
  const lines: string[] = []
  lines.push(`**Goal:** ${brief.goal}`)
  if (brief.context) lines.push(`**Context:** ${brief.context}`)
  if (brief.constraints?.length) {
    lines.push('**Constraints:**')
    for (const c of brief.constraints) lines.push(`- ${c}`)
  }
  if (brief.successCriteria?.length) {
    lines.push('**Success Criteria:**')
    for (const s of brief.successCriteria) lines.push(`- ${s}`)
  }
  return lines.join('\n')
}

/**
 * Merge two ParsedBriefs, preferring the second's fields.
 */
export function mergeBriefs(a: ParsedBrief, b: ParsedBrief): ParsedBrief {
  return {
    brief: b.brief || a.brief,
    goal: b.goal || a.goal,
    context: b.context || a.context,
    constraints: b.constraints?.length ? b.constraints : a.constraints,
    successCriteria: b.successCriteria?.length ? b.successCriteria : a.successCriteria,
  }
}
