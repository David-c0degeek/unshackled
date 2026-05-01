// ─── Types ────────────────────────────────────────────────────────────────────

export type RuleCategory = 'edit' | 'test' | 'agent' | 'general'

export interface Rule {
  id: string
  name: string
  description: string
  category: RuleCategory
  condition: (ctx: RuleContext) => boolean
  message: string
}

export interface RuleContext {
  toolName: string
  args: Record<string, unknown>
  step: number
  messageCount: number
  errors: string[]
}
