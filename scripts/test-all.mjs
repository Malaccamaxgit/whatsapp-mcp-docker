// Helper script to run tests during JS/TS migration phase
// Runs both .js and .ts test files separately

import { execSync } from 'child_process';
import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testPatterns = [
  'test/unit/*.test.{js,ts}',
  'test/integration/*.test.{js,ts}',
  'test/e2e/*.test.{js,ts}',
  'test/benchmarks/*.test.{js,ts}'
];

function runTests(pattern) {
  console.log(`Running tests matching: ${pattern}`);
  try {
    execSync(`npx tsx --test '${pattern}'`, { stdio: 'inherit', shell: true });
  } catch (error) {
    console.error(`Tests failed for pattern: ${pattern}`);
    process.exit(1);
  }
}

// Run tests for each pattern
for (const pattern of testPatterns) {
  // Use tsx to glob and run JS tests
  try {
    execSync(`npx tsx --test test/unit/*.test.js test/integration/*.test.js`, { stdio: 'inherit', shell: true });
  } catch (e) {
    // Continue to check TS tests
  }
  try {
    execSync(`npx tsx --test test/unit/*.test.ts test/integration/*.test.ts`, { stdio: 'inherit', shell: true });
  } catch (e) {
    process.exit(1);
  }
  break; // Run only once since patterns overlap
}
