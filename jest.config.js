{
  "displayName": "unshackled-harness",
  "roots": [
    "<rootDir>/src"
  ],
  "testMatch": [
    "**/__tests__/**/*.{ts,tsx}",
    "**/?(*.)+(spec|test).{ts,tsx}"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
  "testEnvironment": "node",
  "collectCoverageFrom": [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts"
  ],
  "coverageDirectory": "coverage",
  "coverageReporters": ["text", "lcov"]
}