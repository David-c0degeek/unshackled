import { execSync } from 'child_process'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string
  isClean: boolean
  modifiedFiles: string[]
  untrackedFiles: string[]
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const BRANCH_PREFIX = 'harness/'

// ─── Functions ─────────────────────────────────────────────────────────────────

/**
 * Get the current git status
 */
export function getGitStatus(): GitStatus {
  try {
    const branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
    }).trim()

    const statusOutput = execSync('git status --porcelain', {
      encoding: 'utf-8',
    }).trim()

    const modifiedFiles: string[] = []
    const untrackedFiles: string[] = []

    if (statusOutput) {
      statusOutput.split('\n').forEach((line) => {
        const status = line.substring(0, 2)
        const file = line.substring(3)
        if (status.includes('M') || status.includes('A') || status.includes('D')) {
          modifiedFiles.push(file)
        } else if (status.includes('??')) {
          untrackedFiles.push(file)
        }
      })
    }

    return {
      branch,
      isClean: statusOutput.length === 0,
      modifiedFiles,
      untrackedFiles,
    }
  } catch (error) {
    console.error('[harness] Error getting git status:', error)
    return {
      branch: '',
      isClean: false,
      modifiedFiles: [],
      untrackedFiles: [],
    }
  }
}

/**
 * Create a new branch for the harness session
 */
export function createBranch(sessionId: string): string {
  const branch = `${BRANCH_PREFIX}${sessionId.substring(0, 8)}`

  try {
    // Check if branch already exists
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
        stdio: 'ignore',
      })
      // Branch exists, add a timestamp suffix
      const timestamp = Date.now()
      return `${BRANCH_PREFIX}${sessionId.substring(0, 4)}-${timestamp}`
    } catch {
      // Branch doesn't exist, create it
      execSync(`git checkout -b ${branch}`, {
        encoding: 'utf-8',
      })
      console.log(`[harness] Created branch: ${branch}`)
      return branch
    }
  } catch (error) {
    console.error('[harness] Error creating branch:', error)
    return ''
  }
}

/**
 * Switch to a branch
 */
export function switchBranch(branch: string): boolean {
  try {
    execSync(`git checkout ${branch}`, {
      encoding: 'utf-8',
    })
    return true
  } catch (error) {
    console.error('[harness] Error switching branch:', error)
    return false
  }
}

/**
 * Switch back to the original branch
 */
export function switchToBranch(branch: string): boolean {
  return switchBranch(branch)
}

/**
 * Delete a branch
 */
export function deleteBranch(branch: string): boolean {
  try {
    execSync(`git branch -D ${branch}`, {
      encoding: 'utf-8',
    })
    return true
  } catch (error) {
    console.error('[harness] Error deleting branch:', error)
    return false
  }
}

/**
 * Get the list of harness branches
 */
export function listHarnessBranches(): string[] {
  try {
    const output = execSync(`git branch --list '${BRANCH_PREFIX}*'`, {
      encoding: 'utf-8',
    }).trim()

    if (!output) {
      return []
    }

    return output
      .split('\n')
      .map((line) => line.replace(/^\*?\s*/, '').trim())
      .filter(Boolean)
  } catch (error) {
    console.error('[harness] Error listing branches:', error)
    return []
  }
}

/**
 * Commit all changes with a message
 */
export function commitChanges(message: string): boolean {
  try {
    execSync('git add -A', {
      encoding: 'utf-8',
    })
    execSync(`git commit -m "${message}"`, {
      encoding: 'utf-8',
    })
    return true
  } catch (error) {
    console.error('[harness] Error committing changes:', error)
    return false
  }
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(): boolean {
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
    }).trim()
    return status.length > 0
  } catch (error) {
    console.error('[harness] Error checking status:', error)
    return false
  }
}

/**
 * Stash current changes
 */
export function stashChanges(message?: string): boolean {
  try {
    const cmd = message
      ? `git stash push -m "${message}"`
      : 'git stash push'
    execSync(cmd, {
      encoding: 'utf-8',
    })
    return true
  } catch (error) {
    console.error('[harness] Error stashing changes:', error)
    return false
  }
}

/**
 * Pop stashed changes
 */
export function popStash(): boolean {
  try {
    execSync('git stash pop', {
      encoding: 'utf-8',
    })
    return true
  } catch (error) {
    console.error('[harness] Error popping stash:', error)
    return false
  }
}

/**
 * Get the list of branches for a session
 */
export function getBranchesForSession(sessionId: string): string[] {
  const pattern = `${BRANCH_PREFIX}${sessionId.substring(0, 8)}`
  try {
    const output = execSync(`git branch --list '${pattern}*'`, {
      encoding: 'utf-8',
    }).trim()

    if (!output) {
      return []
    }

    return output
      .split('\n')
      .map((line) => line.replace(/^\*?\s*/, '').trim())
      .filter(Boolean)
  } catch (error) {
    console.error('[harness] Error listing branches:', error)
    return []
  }
}

/**
 * Get a short git status string for inclusion in prompt context.
 */
export function getGitStatusForContext(): string {
  try {
    const branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
    }).trim()
    const statusOutput = execSync('git status --porcelain', {
      encoding: 'utf-8',
    }).trim()

    if (!statusOutput) {
      return `Branch: ${branch} (clean)`
    }

    const modified: string[] = []
    const untracked: string[] = []
    statusOutput.split('\n').forEach((line) => {
      const st = line.substring(0, 2)
      const file = line.substring(3)
      if (st.includes('M') || st.includes('A') || st.includes('D')) {
        modified.push(file)
      } else if (st.includes('??')) {
        untracked.push(file)
      }
    })

    const parts: string[] = [`Branch: ${branch}`]
    if (modified.length > 0) {
      parts.push(`Modified: ${modified.join(', ')}`)
    }
    if (untracked.length > 0) {
      parts.push(`Untracked: ${untracked.join(', ')}`)
    }
    return parts.join(' | ')
  } catch {
    return 'Git: unable to determine status'
  }
}
