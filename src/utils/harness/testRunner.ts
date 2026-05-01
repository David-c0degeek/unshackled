import { execa } from 'execa';
import { glob } from 'glob';

/**
 * Detects test frameworks in the project
 */
export async function detectTestFrameworks(): Promise<string[]> {
  const frameworks = [];

  // Check for package.json dependencies
  try {
    const packageJson = await import('../../package.json', { assert: { type: 'json' } });
    const deps = packageJson.default.dependencies || {};
    const devDeps = packageJson.default.devDependencies || {};

    if (deps.jest || devDeps.jest) {
      frameworks.push('jest');
    }
    if (deps.vitest || devDeps.vitest) {
      frameworks.push('vitest');
    }
    if (deps.mocha || devDeps.mocha) {
      frameworks.push('mocha');
    }
    if (deps.cypress || devDeps.cypress) {
      frameworks.push('cypress');
    }
  } catch (error) {
    // If package.json can't be read, fall back to file-based detection
  }

  // Check for test files directly
  try {
    const testFiles = await glob('src/**/*.{test,spec}.{ts,tsx}');
    if (testFiles.length > 0) {
      // If we find test files, try to infer framework from common patterns
      // This is a simplified approach - real implementation would be more sophisticated
      frameworks.push('jest'); // Default assumption for now
    }
  } catch (error) {
    // Ignore glob errors
  }

  return frameworks;
}

/**
 * Run tests for the specified framework
 */
export async function runTests(framework: string): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    let command, args;

    switch (framework) {
      case 'jest':
        command = 'bun';
        args = ['test', '--testPathPattern=src'];
        break;
      case 'vitest':
        command = 'bun';
        args = ['test', '--run'];
        break;
      case 'mocha':
        command = 'bun';
        args = ['test'];
        break;
      default:
        command = 'bun';
        args = ['test'];
    }

    const { stdout, stderr } = await execa(command, args, {
      cwd: process.cwd(),
      timeout: 30000, // 30 second timeout
    });

    return {
      success: true,
      output: `${stdout}\n${stderr}`
    };
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message || 'Failed to run tests'
    };
  }
}

/**
 * Run all detected test suites
 */
export async function runAllTests(): Promise<{ success: boolean; output: string }> {
  const frameworks = await detectTestFrameworks();

  if (frameworks.length === 0) {
    return {
      success: true,
      output: 'No test frameworks detected'
    };
  }

  const results = [];

  for (const framework of frameworks) {
    const result = await runTests(framework);
    results.push({
      framework,
      success: result.success,
      output: result.output,
      error: result.error
    });
  }

  // Combine outputs (in real implementation, this would be more sophisticated)
  const output = results.map(r =>
    `${r.framework}: ${r.success ? '✓' : '✗'}\n${r.output}`
  ).join('\n');

  return {
    success: results.every(r => r.success),
    output
  };
}