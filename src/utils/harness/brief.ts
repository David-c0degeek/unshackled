import fs from 'fs'

export interface Brief {
  name: string
  summary: string
  requirements: string[]
  constraints: string[]
  nonGoals: string[]
  /** LLM-chosen defaults, explicitly annotated */
  annotatedDefaults: string[]
}

const BRIEF_FILE = 'brief.md'

/** Create a new Brief */
export function newBrief(name: string): Brief {
  return {
    name,
    summary: '',
    requirements: [],
    constraints: [],
    nonGoals: [],
    annotatedDefaults: [],
  }
}

/** Load brief.md from the given directory */
export function loadBrief(cwd: string): Brief {
  const path = `${cwd}/${BRIEF_FILE}`
  if (!fs.existsSync(path)) {
    throw new Error(`${BRIEF_FILE} not found`)
  }
  const content = fs.readFileSync(path, 'utf-8')
  return parseBrief(content)
}

/** Save Brief to brief.md */
export function saveBrief(cwd: string, b: Brief): void {
  const path = `${cwd}/${BRIEF_FILE}`
  fs.writeFileSync(path, renderBrief(b))
}

/** Parse a brief.md string into a Brief object */
export function parseBrief(content: string): Brief {
  const name = extractHeader(content) ?? 'Untitled'

  const sections = extractSections(content)
  return {
    name,
    summary: sections.get('Summary')?.trim() ?? '',
    requirements: parseBullets(sections.get('Requirements') ?? ''),
    constraints: parseBullets(sections.get('Constraints') ?? ''),
    nonGoals: parseBullets(sections.get('Non-goals') ?? ''),
    annotatedDefaults: [],
  }
}

/** Render a Brief object to brief.md format */
export function renderBrief(b: Brief): string {
  const lines: string[] = []
  lines.push(`# Brief: ${b.name}`)
  lines.push('')
  lines.push('## Summary')
  lines.push(b.summary)
  lines.push('')
  lines.push('## Requirements')
  for (const req of b.requirements) {
    lines.push(`- ${req}`)
  }
  lines.push('')
  lines.push('## Constraints')
  for (const c of b.constraints) {
    lines.push(`- ${c}`)
  }
  lines.push('')
  lines.push('## Non-goals')
  for (const ng of b.nonGoals) {
    lines.push(`- ${ng}`)
  }
  lines.push('')
  return lines.join('\n')
}

// ------ Private helpers ------

function extractHeader(content: string): string | null {
  const match = content.match(/^#\s+(?:Brief:\s+)?(.+)$/m)
  return match ? match[1].trim() : null
}

function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>()
  // Split by ## headers
  const headerRegex = /^##\s+(.+)$/gm
  let lastMatch: RegExpExecArray | null
  const headers: { name: string; index: number }[] = []

  while ((lastMatch = headerRegex.exec(content)) !== null) {
    headers.push({ name: lastMatch[1].trim(), index: lastMatch.index })
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index + headers[i].name.length + 4 // ## + space + header
    const next = headers[i + 1]
    const end = next?.index ?? content.length
    sections.set(headers[i].name, content.slice(start, end).trim())
  }

  return sections
}

function parseBullets(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^- /, '').trim())
    .filter(Boolean)
}
