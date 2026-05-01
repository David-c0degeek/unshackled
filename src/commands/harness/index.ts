import type { Command } from '../../commands.js'

const harness = {
  type: 'local' as const,
  name: 'harness',
  description: 'Run the harness pipeline (intake → plan → resume)',
  argumentHint: '[new|resume|plan|init]',
  load: () => import('./harness.js'),
} satisfies Command

export default harness
