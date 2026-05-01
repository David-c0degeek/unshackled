import type { Rule, RuleCategory } from './types.js'
import { RULES, RULE_CATEGORIES } from './rules.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RuleRegistry {
  rules: Rule[]
  categories: RuleCategory[]
}

// ─── Registry ──────────────────────────────────────────────────────────────────

/**
 * Get the rule registry
 */
export function getRegistry(): RuleRegistry {
  return {
    rules: RULES,
    categories: RULE_CATEGORIES,
  }
}

/**
 * Register a new rule
 */
export function registerRule(rule: Rule): void {
  // Add to the rules array
  RULES.push(rule)
}

/**
 * Unregister a rule by ID
 */
export function unregisterRule(id: string): void {
  const index = RULES.findIndex((rule) => rule.id === id)
  if (index !== -1) {
    RULES.splice(index, 1)
  }
}

/**
 * Get rules by category
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
 * Check if a rule exists
 */
export function ruleExists(id: string): boolean {
  return RULES.some((rule) => rule.id === id)
}

/**
 * Clear all rules
 */
export function clearRules(): void {
  RULES.length = 0
}
