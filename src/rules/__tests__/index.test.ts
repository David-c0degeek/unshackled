import { registerRule, unregisterRule, getRuleById, getAllRules, clearRules, getRulesByCategory } from '../registry.js'
import type { Rule, RuleCategory } from '../types.js'

describe('Registry', () => {
  beforeEach(() => {
    clearRules()
  })

  afterEach(() => {
    clearRules()
  })

  test('should register and retrieve rules', () => {
    const mockRule: Rule = {
      id: 'test-rule',
      name: 'Test Rule',
      description: 'Test rule',
      category: 'general',
      condition: () => true,
      message: 'Test message',
    }

    registerRule(mockRule)
    const rules = getAllRules()
    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe('test-rule')
  })

  test('should get rule by ID', () => {
    const mockRule: Rule = {
      id: 'find-me',
      name: 'Find Me',
      description: 'Find this rule',
      category: 'edit',
      condition: () => true,
      message: 'Found',
    }

    registerRule(mockRule)
    const found = getRuleById('find-me')
    expect(found).toBeDefined()
    expect(found!.id).toBe('find-me')
  })

  test('should unregister a rule', () => {
    const mockRule: Rule = {
      id: 'to-remove',
      name: 'To Remove',
      description: 'Will be removed',
      category: 'test',
      condition: () => true,
      message: 'Removed',
    }

    registerRule(mockRule)
    expect(getAllRules()).toHaveLength(1)

    unregisterRule('to-remove')
    expect(getAllRules()).toHaveLength(0)
  })

  test('should filter rules by category', () => {
    const editRule: Rule = {
      id: 'edit-rule',
      name: 'Edit Rule',
      description: 'Edit category rule',
      category: 'edit',
      condition: () => true,
      message: 'Edit',
    }

    const testRule: Rule = {
      id: 'test-rule',
      name: 'Test Rule',
      description: 'Test category rule',
      category: 'test',
      condition: () => true,
      message: 'Test',
    }

    registerRule(editRule)
    registerRule(testRule)

    const editRules = getRulesByCategory('edit' as RuleCategory)
    expect(editRules).toHaveLength(1)
    expect(editRules[0].id).toBe('edit-rule')
  })
})
