#!/usr/bin/env bun
// Simple test runner for harness tests

import { spawn } from "child_process";

async function runTests() {
  console.log("Running harness tests...");

  const bun = spawn("bun", ["test", "src/rules/__tests__/", "src/utils/harness/__tests__/"], {
    stdio: "inherit",
  });

  bun.on("close", (code) => {
    if (code === 0) {
      console.log("All harness tests completed successfully!");
    } else {
      process.exit(code || 1);
    }
  });
}

runTests().catch((error) => {
  console.error("Test execution failed:", error);
  process.exit(1);
});
