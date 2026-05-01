import type { Rule, RuleCategory } from './types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RuleContext {
  toolName: string
  args: Record<string, unknown>
  step: number
  messageCount: number
  errors: string[]
}

// ─── Rule Registry ───────────────────────────────────────────────────────────

export const RULES: Rule[] = [
  {
    id: 'read-before-edit',
    name: 'Read Before Edit',
    description:
      'Always read a file before editing it. Never edit a file without reading it first.',
    category: 'edit',
    condition: (ctx) => ctx.toolName === 'Edit',
    message: 'Read the file first to understand its structure before editing.',
  },
  {
    id: 'test-before-commit',
    name: 'Test Before Commit',
    description: 'Run tests before committing changes.',
    category: 'test',
    condition: (ctx) => ctx.toolName === 'Bash' && ctx.args.command?.includes('git commit'),
    message: 'Run tests before committing.',
  },
]

// ─── Rule Categories ───────────────────────────────────────────────────────────

export const RULE_CATEGORIES: RuleCategory[] = ['edit', 'test', 'agent', 'general']

// ─── Rule Checker ───────────────────────────────────────────────────────────

/**
 * Get all rules for a category
 */
export function getRulesByCategory(category: RuleCategory): Rule[] {
  return RULES.filter((rule) => rule.category === category)
}

/**
 * Get all rules
 */
export function getAllRules(): Rule[] {
  return [...RULES]
}

/**
 * Get a rule by ID
 */
export function getRuleById(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id)
}

/**
 * Check if a rule should fire
 */
export function shouldFireRule(rule: Rule, ctx: RuleContext): boolean {
  return rule.condition(ctx)
}

/**
 * Check all rules for a context
 */
export function checkAllRules(ctx: RuleContext): Rule[] {
  return RULES.filter((rule) => shouldFireRule(rule, ctx))
}

/**
 * Fire a rule (show message)
 */
export function fireRule(rule: Rule): void {
  console.log(`[rule:${rule.id}] ${rule.message}`)
}

/**
 * Fire all rules for a context
 */
export function fireAllRules(ctx: RuleContext): void {
  const matchingRules = checkAllRules(ctx)
  matchingRules.forEach((rule) => fireRule(rule))
}

/**
 * Apply all matching rules for a context (fire + return matched).
 */
export function applyRules(ctx: RuleContext): Rule[] {
  const matchingRules = checkAllRules(ctx)
  matchingRules.forEach((rule) => fireRule(rule))
  return matchingRules
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Detect test command from a brief
 */
export function detectTestCommand(brief: string): string | null {
  const patterns = [
    /test[:\s]+(.+?)(?:\.|$)/i,
    /command[:\s]+(.+?)(?:\.|$)/i,
    /run[:\s]+(.+?)(?:\.|$)/i,
  ]

  for (const pattern of patterns) {
    const match = brief.match(pattern)
    if (match) {
      return match[1].trim()
    }
  }

  return null
}

/**
 * Find files matching a pattern
 */
export function findFiles(pattern: string): string[] {
  // In the future, this will use glob or similar
  return []
}

/**
 * Check if a file matches a pattern
 */
export function matchesPattern(file: string, pattern: string): boolean {
  return file.includes(pattern)
}
