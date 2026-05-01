import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MiddlewareContext {
  step: number
  totalSteps: number
  messages: Message[]
  errors: string[]
}

export interface MiddlewareResult {
  shouldContinue: boolean
  error?: string
  action?: 'retry' | 'rollback' | 'commit' | 'pause'
  message?: string
}

export interface Middleware {
  name: string
  priority: number
  beforeStep: (ctx: MiddlewareContext) => MiddlewareResult | null
  afterStep: (ctx: MiddlewareContext, success: boolean, duration: number) => MiddlewareResult | null
}

// ─── Built-in middleware ─────────────────────────────────────────────────────

/**
 * Validation middleware - checks for common errors after each step
 */
export const validationMiddleware: Middleware = {
  name: 'validation',
  priority: 100,
  beforeStep: (ctx) => {
    // Check if we're about to exceed the step limit
    if (ctx.step > ctx.totalSteps) {
      return {
        shouldContinue: false,
        message: `Step limit exceeded (${ctx.totalSteps} steps)`,
      }
    }

    // Check if there are too many errors
    if (ctx.errors.length > 5) {
      return {
        shouldContinue: false,
        message: `Too many errors (${ctx.errors.length})`,
      }
    }

    return null
  },
  afterStep: (ctx, success, duration) => {
    if (!success) {
      // Check if this is a recoverable error
      const lastError = ctx.errors[ctx.errors.length - 1]
      if (lastError?.includes('syntax') || lastError?.includes('parse')) {
        return {
          shouldContinue: true,
          action: 'retry',
          message: 'Syntax error detected, will retry',
        }
      }
    }

    return null
  },
}

/**
 * Branch management middleware - manages git branches
 */
export const branchMiddleware: Middleware = {
  name: 'branch',
  priority: 200,
  beforeStep: (ctx) => {
    // Check if we need to create a branch
    if (ctx.step === 1) {
      // This will be handled by the harness command
      return null
    }

    // Check if there are uncommitted changes
    try {
      const { execSync } = require('child_process')
      const status = execSync('git status --porcelain', {
        encoding: 'utf-8',
      }).trim()

      if (status && ctx.step % 3 === 0) {
        // Commit every 3 steps
        return {
          shouldContinue: true,
          action: 'commit',
          message: 'Committing changes after every 3 steps',
        }
      }
    } catch {
      // Not a git repo, skip branch management
    }

    return null
  },
  afterStep: () => {
    return null
  },
}

/**
 * Performance monitoring middleware
 */
export const performanceMiddleware: Middleware = {
  name: 'performance',
  priority: 300,
  beforeStep: (ctx) => {
    return null
  },
  afterStep: (ctx, success, duration) => {
    // Log slow steps
    if (duration > 30000) {
      console.warn(`[harness] Step ${ctx.step} took ${duration}ms (>30s)`)
    }

    // Check for memory issues (simulated)
    if (ctx.messages.length > 100) {
      console.warn(`[harness] Large conversation (${ctx.messages.length} messages)`)
    }

    return null
  },
}

/**
 * Error recovery middleware
 */
export const recoveryMiddleware: Middleware = {
  name: 'recovery',
  priority: 400,
  beforeStep: (ctx) => {
    return null
  },
  afterStep: (ctx, success, duration) => {
    if (!success) {
      // Check if we can recover from this error
      const lastError = ctx.errors[ctx.errors.length - 1]
      if (lastError?.includes('permission') || lastError?.includes('denied')) {
        return {
          shouldContinue: true,
          action: 'pause',
          message: 'Permission denied, waiting for user input',
        }
      }
    }

    return null
  },
}

// ─── Middleware manager ─────────────────────────────────────────────────────

/**
 * Manager for running middleware in order
 */
export class MiddlewareManager {
  private middlewares: Middleware[] = []

  constructor() {
    // Register default middlewares
    this.register(validationMiddleware)
    this.register(branchMiddleware)
    this.register(performanceMiddleware)
    this.register(recoveryMiddleware)
  }

  /**
   * Register a middleware
   */
  register(middleware: Middleware): void {
    this.middlewares.push(middleware)
    // Sort by priority
    this.middlewares.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Run all beforeStep hooks
   */
  async runBeforeStep(ctx: MiddlewareContext): Promise<MiddlewareResult | null> {
    for (const middleware of this.middlewares) {
      const result = middleware.beforeStep(ctx)
      if (result) {
        return result
      }
    }
    return null
  }

  /**
   * Run all afterStep hooks
   */
  async runAfterStep(
    ctx: MiddlewareContext,
    success: boolean,
    duration: number,
  ): Promise<MiddlewareResult | null> {
    for (const middleware of this.middlewares) {
      const result = middleware.afterStep(ctx, success, duration)
      if (result) {
        return result
      }
    }
    return null
  }

  /**
   * Get all registered middleware
   */
  getMiddlewares(): Middleware[] {
    return [...this.middlewares]
  }

  /**
   * Remove a middleware by name
   */
  removeMiddleware(name: string): void {
    this.middlewares = this.middlewares.filter((m) => m.name !== name)
  }

  /**
   * Clear all middleware
   */
  clear(): void {
    this.middlewares = []
  }
}
