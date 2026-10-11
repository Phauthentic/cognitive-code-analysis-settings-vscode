import * as path from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60_000 });
  mocha.addFile(path.resolve(__dirname, 'extension.test.js'));
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${String(failures)} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
