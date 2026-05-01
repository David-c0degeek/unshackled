import path from 'path'
import fs from 'fs'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessConfig {
  maxSteps: number
  defaultModel: string
  temperature: number
  maxTokens: number
  enableBranches: boolean
  enableTests: boolean
  enableMiddleware: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  progressDir: string
  sessionDir: string
}

// ─── Defaults ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: HarnessConfig = {
  maxSteps: 20,
  defaultModel: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: 4096,
  enableBranches: true,
  enableTests: true,
  enableMiddleware: true,
  logLevel: 'info',
  progressDir: path.join(process.cwd(), '.free-code', 'harness'),
  sessionDir: path.join(process.cwd(), '.free-code', 'harness', 'sessions'),
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let cachedConfig: HarnessConfig | null = null

/**
 * Get the default config
 */
export function getDefaultConfig(): HarnessConfig {
  return { ...DEFAULT_CONFIG }
}

/**
 * Load the config from file
 */
export function loadConfig(): HarnessConfig {
  if (cachedConfig) {
    return { ...cachedConfig }
  }

  const configPath = path.join(process.cwd(), '.free-code', 'harness', 'config.json')

  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf-8')
      const userConfig = JSON.parse(data) as Partial<HarnessConfig>
      cachedConfig = { ...DEFAULT_CONFIG, ...userConfig }
      return cachedConfig
    } catch (error) {
      console.error('[harness] Error loading config:', error)
    }
  }

  cachedConfig = { ...DEFAULT_CONFIG }
  return cachedConfig
}

/**
 * Save the config to file
 */
export function saveConfig(config: HarnessConfig): void {
  const configDir = path.join(process.cwd(), '.free-code', 'harness')
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const configPath = path.join(configDir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  cachedConfig = { ...config }
}

/**
 * Get a config value
 */
export function getConfig<T extends keyof HarnessConfig>(key: T): HarnessConfig[T] {
  const config = loadConfig()
  return config[key]
}

/**
 * Set a config value
 */
export function setConfig<T extends keyof HarnessConfig>(
  key: T,
  value: HarnessConfig[T],
): void {
  const config = loadConfig()
  config[key] = value
  saveConfig(config)
}

/**
 * Reset the config to defaults
 */
export function resetConfig(): void {
  cachedConfig = null
  saveConfig(DEFAULT_CONFIG)
}
