import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '../../..');
  await runTests({
    // Minimum supported version (engines.vscode), so the tests prove the lowest version we claim to support.
    version: '1.96.0',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite/index'),
    launchArgs: [
      path.join(root, 'test/fixtures/workspace'),
      '--disable-workspace-trust',
      '--disable-extensions',
      // Electron's sandbox does not work inside unprivileged containers.
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
  });
}

main().catch((error: unknown) => {
  console.error('E2E tests failed', error);
  process.exit(1);
});
