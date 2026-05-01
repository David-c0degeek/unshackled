import { Command, Option } from 'commander'
import chalk from 'chalk'
import path from 'path'
import fs from 'fs'
import { readBrief } from '../../utils/harness/intake.js'
import { generatePlan } from '../../utils/harness/planner.js'
import { HarnessWorker } from '../../utils/harness/worker.js'
import {
  saveProgress,
  loadProgress,
  getProgressPath,
  getHarnessDir,
  getSessionsDir,
} from '../../utils/harness/progress.js'
import {
  applyRules,
  detectTestCommand,
} from '../../rules/rules.js'
import type { Rule } from '../../rules/types.js'

// ─── Command registration ───────────────────────────────────────────────────────

export const harnessCommand = new Command('harness')
  .description('Multi-step autonomous agent harness')
  .argument('[brief]', 'Brief description of the task')
  .addOption(
    new Option('-i, --instructions <text>', 'Additional instructions for the agent')
      .default(''),
  )
  .addOption(
    new Option('-m, --max-steps <n>', 'Maximum number of steps')
      .default('20')
      .argParser((v) => parseInt(v, 10)),
  )
  .addOption(
    new Option(
      '-s, --system-prompt <text>',
      'Custom system prompt for the agent',
    ),
  )
  .addOption(
    new Option('-c, --continue', 'Continue from the last step')
      .default(false),
  )
  .addOption(
    new Option('-p, --plan-only', 'Generate and save the plan without executing')
      .default(false),
  )
  .addOption(
    new Option('-d, --dry-run', 'Show what would be done without executing')
      .default(false),
  )
  .addOption(
    new Option('-r, --rules <rule...>', 'Specific rules to apply')
      .default([]),
  )
  .addOption(
    new Option('-e, --exclude-rules <rule...>', 'Rules to exclude')
      .default([]),
  )
  .action(async (brief, options) => {
    await runHarness(brief, options)
  })

// ─── Subcommands ─────────────────────────────────────────────────────────────────

harnessCommand
  .command('status')
  .description('Show the current harness session status')
  .action(async () => {
    const progressPath = getProgressPath()
    if (!fs.existsSync(progressPath)) {
      console.log(chalk.red('No harness session found. Start one with `harness <brief>`'))
      return
    }

    const progress = loadProgress()
    if (!progress) {
      console.log(chalk.red('Could not load harness session data'))
      return
    }

    console.log(chalk.bold('\n📋 Harness Session Status\n'))
    console.log(`  Brief:       ${chalk.cyan(progress.brief)}\n`)
    console.log(`  Session:     ${chalk.cyan(progress.sessionId)}\n`)

    console.log('  Progress:')
    console.log(`    Status:      ${chalk.yellow(progress.status)}\n`)
    console.log(`    Step:        ${chalk.cyan(`${progress.currentStep}/${progress.totalSteps}`)}\n`)

    if (progress.branch) {
      console.log(`    Branch:      ${chalk.cyan(progress.branch)}\n`)
    }

    if (progress.errors.length > 0) {
      console.log(chalk.red('  Errors:'))
      progress.errors.forEach((err) => {
        console.log(`    - ${err}`)
      })
      console.log()
    }

    if (progress.steps.length > 0) {
      console.log(chalk.bold('  Completed Steps:'))
      progress.steps.forEach((step, i) => {
        const icon = step.success ? '✅' : '❌'
        const status = step.success ? chalk.green('OK') : chalk.red('FAILED')
        console.log(`    ${icon} ${chalk.bold(`Step ${step.step}:`)} ${status}`)
        console.log(`       ${chalk.dim(step.description)}`)
        console.log()
      })
    }

    console.log(chalk.dim(`  Config: maxSteps=${progress.maxSteps}`))
  })

harnessCommand
  .command('resume')
  .description('Resume a paused or failed harness session')
  .addOption(
    new Option('-s, --step <n>', 'Resume from a specific step')
      .argParser((v) => parseInt(v, 10)),
  )
  .addOption(
    new Option('-f, --force', 'Force resume even if not paused/failed')
      .default(false),
  )
  .action(async (options) => {
    const progressPath = getProgressPath()
    if (!fs.existsSync(progressPath)) {
      console.log(chalk.red('No harness session found. Start one with `harness <brief>`'))
      return
    }

    const progress = loadProgress()
    if (!progress) {
      console.log(chalk.red('Could not load harness session data'))
      return
    }

    // If not paused/failed and --force is not set, just continue
    if (!['paused', 'failed'].includes(progress.status) && !options.force) {
      console.log(chalk.yellow('Session is not paused or failed. Use --force to continue anyway'))
      return
    }

    // If step is specified, set it
    if (options.step !== undefined) {
      progress.currentStep = options.step
    }

    // Update status
    progress.status = 'running'
    progress.pausedAt = undefined
    progress.pausedBy = undefined
    progress.pausedAtStep = undefined
    saveProgress(progress)

    console.log(chalk.green(`\n🚀 Resuming harness session...\n`)
      + `  Brief:       ${chalk.cyan(progress.brief)}\n`
      + `  Session:     ${chalk.cyan(progress.sessionId)}\n`
      + `  Resume from: ${chalk.cyan(`${progress.currentStep}/${progress.totalSteps}`)}\n`)

    await runHarness(progress.brief, {
      maxSteps: progress.maxSteps,
      continue: true,
      planOnly: false,
      dryRun: false,
      rules: [],
      excludeRules: [],
      instructions: progress.instructions ?? '',
      systemPrompt: progress.systemPrompt,
    })
  })

harnessCommand
  .command('pause')
  .description('Pause the current harness session')
  .action(async () => {
    const progressPath = getProgressPath()
    if (!fs.existsSync(progressPath)) {
      console.log(chalk.red('No harness session found. Start one with `harness <brief>`'))
      return
    }

    const progress = loadProgress()
    if (!progress) {
      console.log(chalk.red('Could not load harness session data'))
      return
    }

    progress.status = 'paused'
    progress.pausedAt = new Date().toISOString()
    progress.pausedBy = process.env.USER ?? 'user'
    progress.pausedAtStep = progress.currentStep
    saveProgress(progress)

    console.log(chalk.yellow(`\n⏸️  Harness session paused at step ${progress.currentStep}/${progress.totalSteps}`))
    console.log(chalk.dim(`  Session: ${progress.sessionId}`))
    console.log(chalk.dim(`  Brief: ${progress.brief}`))
    console.log(chalk.dim(`  Resume with: \`harness resume\``))
  })

harnessCommand
  .command('stop')
  .description('Stop the current harness session')
  .action(async () => {
    const progressPath = getProgressPath()
    if (!fs.existsSync(progressPath)) {
      console.log(chalk.red('No harness session found. Start one with `harness <brief>`'))
      return
    }

    const progress = loadProgress()
    if (!progress) {
      console.log(chalk.red('Could not load harness session data'))
      return
    }

    progress.status = 'stopped'
    progress.stoppedAt = new Date().toISOString()
    saveProgress(progress)

    console.log(chalk.red(`\n⏹️  Harness session stopped`)
      + `\n  Session: ${chalk.cyan(progress.sessionId)}`
      + `\n  Brief: ${chalk.cyan(progress.brief)}`
      + `\n  Final step: ${progress.currentStep}/${progress.totalSteps}`)
  })

harnessCommand
  .command('plan')
  .description('Show the current harness plan')
  .action(async () => {
    const progressPath = getProgressPath()
    if (!fs.existsSync(progressPath)) {
      console.log(chalk.red('No harness session found. Start one with `harness <brief>`'))
      return
    }

    const progress = loadProgress()
    if (!progress) {
      console.log(chalk.red('Could not load harness session data'))
      return
    }

    console.log(chalk.bold('\n📋 Harness Plan\n'))
    console.log(`  Brief: ${chalk.cyan(progress.brief)}\n`)

    if (progress.steps.length > 0) {
      console.log(chalk.bold('  Tasks:'))
      progress.steps.forEach((step, i) => {
        const icon = step.success ? '✅' : step.status === 'pending' ? '⬜' : '❌'
        const status = step.status === 'pending' ? chalk.dim('PENDING') :
          step.success ? chalk.green('COMPLETED') : chalk.red('FAILED')
        console.log(`    ${icon} ${chalk.bold(`Step ${step.step}:`)} ${status}`)
        console.log(`       ${chalk.dim(step.description)}`)
        console.log()
      })
    } else {
      console.log(chalk.dim('  No tasks defined yet'))
    }
  })

harnessCommand
  .command('list')
  .description('List all harness sessions')
  .action(async () => {
    const sessionsDir = getSessionsDir()
    if (!fs.existsSync(sessionsDir)) {
      console.log(chalk.dim('No harness sessions found'))
      return
    }

    const sessions = fs.readdirSync(sessionsDir)
    if (sessions.length === 0) {
      console.log(chalk.dim('No harness sessions found'))
      return
    }

    console.log(chalk.bold('\n📋 Harness Sessions\n'))
    sessions.forEach((session) => {
      const sessionPath = path.join(sessionsDir, session)
      const progressPath = path.join(sessionPath, 'progress.json')
      if (fs.existsSync(progressPath)) {
        const progress = loadProgress()
        if (progress) {
          const statusColor = progress.status === 'completed' ? chalk.green :
            progress.status === 'running' ? chalk.blue :
            progress.status === 'paused' ? chalk.yellow :
            progress.status === 'failed' ? chalk.red : chalk.dim
          console.log(`  ${chalk.cyan(session)}`)
          console.log(`    Status: ${statusColor(progress.status)}`)
          console.log(`    Brief:  ${chalk.dim(progress.brief)}`)
          console.log(`    Steps:  ${progress.currentStep}/${progress.totalSteps}`)
          console.log()
        }
      }
    })
  })

// ─── Main harness execution ─────────────────────────────────────────────────────

async function runHarness(
  brief: string | undefined,
  options: {
    instructions?: string
    maxSteps?: number
    systemPrompt?: string
    continue?: boolean
    planOnly?: boolean
    dryRun?: boolean
    rules?: string[]
    excludeRules?: string[]
  },
): Promise<void> {
  if (!brief) {
    console.log(chalk.red('Please provide a brief description of the task')
      + '\nExample: `harness "Add dark mode support to the UI"`')
    return
  }

  const maxSteps = options.maxSteps ?? 20

  console.log(chalk.bold('\n🤖 Starting Harness Session\n')
    + `  Brief: ${chalk.cyan(brief)}\n`
    + `  Max Steps: ${chalk.cyan(String(maxSteps))}\n`)

  // Step 1: Read the brief
  console.log(chalk.dim('📋 Step 1/4: Reading brief...')
    + '\n')
  const parsedBrief = readBrief(brief)
  console.log(chalk.green('  ✅ Brief parsed successfully')
    + `\n  Goal: ${chalk.cyan(parsedBrief.goal)}`)
  console.log()

  // Step 2: Generate the plan
  console.log(chalk.dim('📝 Step 2/4: Generating plan...')
    + '\n')
  const plan = await generatePlan(parsedBrief, maxSteps)
  console.log(chalk.green('  ✅ Plan generated successfully')
    + `\n  Total steps: ${chalk.cyan(String(plan.steps.length))}`)
  plan.steps.forEach((step, i) => {
    console.log(`    ${chalk.dim(`${i + 1}.`)} ${chalk.cyan(step.description)}`)
  })
  console.log()

  // Step 3: Save the plan and initialize progress
  const progressPath = getProgressPath()
  const progress = {
    sessionId: Date.now().toString(),
    brief,
    goal: parsedBrief.goal,
    instructions: options.instructions ?? '',
    systemPrompt: options.systemPrompt,
    status: options.planOnly ? 'plan-only' : 'running',
    currentStep: 0,
    totalSteps: plan.steps.length,
    steps: plan.steps.map((step, i) => ({
      ...step,
      status: i === 0 && !options.planOnly ? 'pending' : 'pending',
      success: false,
      durationMs: 0,
      error: '',
    })),
    errors: [],
    maxSteps,
    branch: null,
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    pausedAt: undefined,
    pausedBy: undefined,
    pausedAtStep: undefined,
    stoppedAt: undefined,
  }

  saveProgress(progress)
  console.log(chalk.green('  ✅ Progress saved to disk')
    + `\n  Session ID: ${chalk.cyan(progress.sessionId)}`)
  console.log()

  if (options.planOnly) {
    console.log(chalk.green('\n✅ Plan-only mode: no execution performed'))
    console.log(chalk.dim(`  Progress saved to: ${progressPath}`))
    console.log(chalk.dim('  Resume with: `harness resume`'))
    return
  }

  // Step 4: Execute the plan
  console.log(chalk.dim('⚙️  Step 3/4: Executing plan...')
    + '\n')

  // Apply rules
  const allRules = applyRules(options.rules, options.excludeRules)
  console.log(chalk.dim(`  Rules applied: ${allRules.length}`)
    + (allRules.length > 0 ? `\n  ${allRules.map(r => chalk.cyan(r.name)).join(', ')}` : '')
    + '\n')

  // Detect test command
  const testCommand = detectTestCommand()
  if (testCommand) {
    console.log(chalk.dim(`  Test command detected: ${chalk.cyan(testCommand)}`))
  }

  // Create the worker with streaming callbacks
  const worker = new HarnessWorker({
    prompt: brief,
    instructions: options.instructions ?? '',
    systemPrompt: options.systemPrompt,
    maxSteps: maxSteps,
    callbacks: {
      onStepStart: (step, description) => {
        console.log(chalk.dim(`\n  🔄 Step ${step}/${progress.totalSteps}: ${description}`))
      },
      onToolCall: (toolName, args) => {
        console.log(chalk.dim(`    🔧 ${toolName}(${JSON.stringify(args).substring(0, 50)}...)`)
          + (JSON.stringify(args).length > 50 ? '...' : ''))
      },
      onToolResult: (toolName, summary) => {
        console.log(chalk.dim(`    ✅ ${toolName} completed`)
          + (summary ? ` - ${summary.substring(0, 50)}` : ''))
      },
      onTextDelta: (text) => {
        // For now, just accumulate - could stream to console
      },
      onStepComplete: (step, success) => {
        if (success) {
          console.log(chalk.green(`    ✅ Step ${step} completed successfully`)
            + '\n')
        } else {
          console.log(chalk.red(`    ❌ Step ${step} failed`)
            + '\n')
        }
      },
      onError: (error) => {
        console.log(chalk.red(`    ⚠️  ${error}`))
      },
      onMessageAdded: () => {
        // Track messages
      },
    },
  })

  // Run the worker
  const result = await worker.run()

  // Update progress with results
  progress.status = result.success ? 'completed' : 'failed'
  progress.completedAt = new Date().toISOString()
  saveProgress(progress)

  // Display results
  console.log(chalk.bold('\n📊 Execution Results\n'))
  console.log(`  Success: ${result.success ? chalk.green('✅ Yes') : chalk.red('❌ No')}`)
  console.log(`  Steps: ${chalk.cyan(`${result.steps.length}/${progress.totalSteps}`)}`)
  console.log(`  Messages: ${chalk.cyan(String(result.finalMessageCount))}`)

  if (result.steps.length > 0) {
    console.log(chalk.bold('\n  Completed Steps:')
      + '\n')
    result.steps.forEach((step) => {
      const icon = step.success ? '✅' : '❌'
      const status = step.success ? chalk.green('OK') : chalk.red('FAILED')
      console.log(`    ${icon} ${chalk.bold(`Step ${step.step}:`)} ${status}`)
      console.log(`       ${chalk.dim(step.description)}`)
      console.log()
    })
  }

  if (result.error) {
    console.log(chalk.red(`\n  Error: ${result.error}`))
  }

  console.log(chalk.green('\n✅ Harness session completed'))
  console.log(chalk.dim(`  Session ID: ${progress.sessionId}`))
  console.log(chalk.dim(`  Progress saved to: ${progressPath}`))
}
