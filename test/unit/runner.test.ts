import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Runner,
  buildArgs,
  buildCommand,
  describeFailure,
  resolveConfigFile,
  resolveExecutable,
  tempRelativePath,
} from '../../src/runner';

const WS = '/work/project';
const never = (): boolean => false;
const always = (): boolean => true;

describe('resolveExecutable', () => {
  it('resolves relative settings against the workspace folder when present', () => {
    assert.equal(resolveExecutable('vendor/bin/phpcca', WS, always), path.join(WS, 'vendor/bin/phpcca'));
  });

  it('falls back to phpcca on PATH when the default is missing', () => {
    assert.equal(resolveExecutable('vendor/bin/phpcca', WS, never), 'phpcca');
    assert.equal(resolveExecutable('vendor/bin/phpcca', undefined, always), 'phpcca');
  });

  it('keeps custom settings as-is when they cannot be resolved', () => {
    assert.equal(resolveExecutable('/opt/phpcca', WS, never), '/opt/phpcca');
    assert.equal(resolveExecutable('/opt/phpcca', undefined, always), '/opt/phpcca');
    assert.equal(resolveExecutable('custom-phpcca', WS, never), 'custom-phpcca');
  });
});

describe('resolveConfigFile', () => {
  it('uses the explicit setting, resolved against the workspace', () => {
    assert.equal(resolveConfigFile('conf/p.yaml', WS, never), path.join(WS, 'conf/p.yaml'));
  });

  it('uses phpcca.yaml of the workspace when present', () => {
    assert.equal(resolveConfigFile('', WS, always), path.join(WS, 'phpcca.yaml'));
  });

  it('passes nothing when there is no config', () => {
    assert.equal(resolveConfigFile('', WS, never), undefined);
    assert.equal(resolveConfigFile('', undefined, always), undefined);
  });
});

describe('buildArgs', () => {
  it('builds the analyse command', () => {
    assert.deepEqual(buildArgs('/t/A.php', '/t/r.sarif'), ['analyse', '/t/A.php', '-r', 'sarif', '-f', '/t/r.sarif']);
  });

  it('appends the config file', () => {
    assert.deepEqual(buildArgs('/t/A.php', '/t/r.sarif', '/c.yaml').slice(-2), ['-c', '/c.yaml']);
  });
});

describe('tempRelativePath', () => {
  it('mirrors the workspace-relative path', () => {
    assert.equal(tempRelativePath(path.join(WS, 'src/A.php'), WS), path.join('src', 'A.php'));
  });

  it('uses the basename outside the workspace or without one', () => {
    assert.equal(tempRelativePath('/elsewhere/A.php', WS), 'A.php');
    assert.equal(tempRelativePath('/elsewhere/A.php'), 'A.php');
    assert.equal(tempRelativePath(path.join(WS, '..', 'sibling', 'A.php'), WS), 'A.php');
  });

  it('keeps files whose name merely starts with two dots inside the workspace', () => {
    assert.equal(tempRelativePath(path.join(WS, '..hidden', 'A.php'), WS), path.join('..hidden', 'A.php'));
  });

  it('uses the basename for the workspace folder itself', () => {
    assert.equal(tempRelativePath(WS, WS), 'project');
  });
});

describe('buildCommand', () => {
  const args = ['analyse', 'C:\\t\\A.php'];

  it('executes phpcca directly on Linux and macOS', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      assert.deepEqual(buildCommand('/p/vendor/bin/phpcca', args, platform), { file: '/p/vendor/bin/phpcca', args });
    }
  });

  it('runs phpcca through php on Windows', () => {
    assert.deepEqual(buildCommand('C:\\p\\vendor\\bin\\phpcca', args, 'win32'), {
      file: 'php',
      args: ['C:\\p\\vendor\\bin\\phpcca', ...args],
    });
    assert.equal(buildCommand('x', args, 'win32', 'C:\\php\\php.exe').file, 'C:\\php\\php.exe');
  });
});

describe('describeFailure', () => {
  it('uses the message alone when stderr is empty', () => {
    assert.equal(describeFailure(Object.assign(new Error('Command failed'), { stderr: '  \n' })), 'Command failed');
    assert.equal(describeFailure(new Error('spawn x ENOENT')), 'spawn x ENOENT');
  });

  it('appends stderr unless the message already has it', () => {
    assert.equal(describeFailure(Object.assign(new Error('failed'), { stderr: 'boom\n' })), 'failed\nboom');
    assert.equal(describeFailure(Object.assign(new Error('failed\nboom'), { stderr: 'boom' })), 'failed\nboom');
  });
});

describe('Runner', () => {
  let dir: string;
  let tempRoot: string;
  const sarifBody = JSON.stringify({
    runs: [{ results: [{ message: { text: 'm' }, locations: [{ physicalLocation: { region: { startLine: 2 } } }] }] }],
  });

  /** Writes an executable shell script standing in for phpcca. `$2` is the analysed file, `$6` the -f report. */
  function fake(name: string, body: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  }

  function request(executable: string, extra: Partial<Parameters<Runner['run']>[1]> = {}): Parameters<Runner['run']>[1] {
    return {
      documentPath: path.join(dir, 'src', 'A.php'),
      text: '<?php // unsaved',
      workspaceFolder: dir,
      executable,
      configFile: '',
      ...extra,
    };
  }

  const leftovers = (): string[] => fs.readdirSync(tempRoot);
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
    tempRoot = path.join(dir, 'tmp');
    fs.mkdirSync(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('analyses the buffer text, not the file on disk, and cleans up', async () => {
    const exe = fake('ok', `grep -q 'unsaved' "$2" || exit 3\necho '${sarifBody}' > "$6"`);
    const findings = await new Runner({ tempRoot }).run('k', request(exe));
    assert.deepEqual(findings?.map((f) => f.line), [2]);
    assert.deepEqual(leftovers(), []);
  });

  it('runs in the temp dir with an absolute config so the project never gets a cache directory', async () => {
    fs.writeFileSync(path.join(dir, 'phpcca.yaml'), 'cognitive: {}\n');
    const log = path.join(dir, 'args.log');
    const exe = fake('spy', `pwd > '${log}'\necho "$@" >> '${log}'\nmkdir -p ./.phpcca.cache\necho '${sarifBody}' > "$6"`);
    await new Runner({ tempRoot }).run('k', request(exe));
    const [cwd = '', args = ''] = fs.readFileSync(log, 'utf8').split('\n');
    assert.ok(cwd.startsWith(fs.realpathSync(tempRoot)), `cwd ${cwd}`);
    assert.ok(args.endsWith(`-c ${path.join(dir, 'phpcca.yaml')}`), args);
    assert.ok(args.includes(path.join('src', 'A.php')), 'mirrors the relative path');
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.phpcca')), []);
  });

  it('accepts a non-zero exit when a valid report was written', async () => {
    const exe = fake('nonzero', `echo '${sarifBody}' > "$6"\nexit 1`);
    assert.equal((await new Runner({ tempRoot }).run('k', request(exe)))?.length, 1);
  });

  it('treats an empty report as no findings', async () => {
    const exe = fake('empty', `echo '{"runs":[{"results":[]}]}' > "$6"`);
    assert.deepEqual(await new Runner({ tempRoot }).run('k', request(exe)), []);
  });

  it('rejects when exit 0 produced no or malformed report, without temp paths in the message', async () => {
    const none = fake('none', 'exit 0');
    const malformed = fake('malformed', 'echo "{not json" > "$6"');
    for (const exe of [none, malformed]) {
      await assert.rejects(new Runner({ tempRoot }).run('k', request(exe)), (error: Error) => {
        assert.match(error.message, /no readable SARIF report/);
        assert.ok(!error.message.includes(tempRoot), error.message);
        return true;
      });
    }
    assert.deepEqual(leftovers(), []);
  });

  it('rejects with stderr and the real document path instead of the temp path', async () => {
    const exe = fake('broken', 'echo "boom in $2" >&2\nexit 2');
    await assert.rejects(new Runner({ tempRoot }).run('k', request(exe)), (error: Error) => {
      assert.match(error.message, /boom in /);
      assert.ok(error.message.includes(path.join(dir, 'src', 'A.php')), error.message);
      assert.ok(!error.message.includes(tempRoot), error.message);
      return true;
    });
  });

  it('gives identical messages for identical failures so they can be deduplicated', async () => {
    const exe = fake('broken', 'echo boom >&2\nexit 2');
    const runner = new Runner({ tempRoot });
    const messages = await Promise.all(
      [1, 2].map((n) => runner.run(`k${String(n)}`, request(exe)).catch((error: unknown) => (error as Error).message)),
    );
    assert.equal(messages[0], messages[1]);
  });

  it('rejects when the executable does not exist', async () => {
    await assert.rejects(new Runner({ tempRoot }).run('k', request(path.join(dir, 'missing'))), /ENOENT/);
  });

  it('rejects when the output exceeds maxBuffer and cleans up', async () => {
    const exe = fake('chatty', 'yes xxxxxxxxxxxxxxxx | head -c 100000');
    await assert.rejects(new Runner({ tempRoot, maxOutputBytes: 1024 }).run('k', request(exe)), /maxBuffer/);
    assert.deepEqual(leftovers(), []);
  });

  it('kills the superseded run for the same key', async () => {
    const marker = path.join(dir, 'marker');
    const slow = fake('slow', `sleep 1\ntouch '${marker}'\necho '${sarifBody}' > "$6"`);
    const fast = fake('fast', `echo '${sarifBody}' > "$6"`);
    const runner = new Runner({ tempRoot });
    const started = Date.now();
    const first = runner.run('k', request(slow));
    await sleep(100);
    const second = await runner.run('k', request(fast));
    assert.equal(await first, undefined);
    assert.equal(second?.length, 1);
    assert.ok(Date.now() - started < 900, 'the cancelled run must not be waited for');
    await sleep(1200);
    assert.ok(!fs.existsSync(marker), 'the cancelled child kept running');
    assert.deepEqual(leftovers(), []);
  });

  it('runs different keys concurrently without cancelling each other', async () => {
    const exe = fake('ok', `sleep 0.2\necho '${sarifBody}' > "$6"`);
    const runner = new Runner({ tempRoot });
    const [a, b] = await Promise.all([runner.run('a', request(exe)), runner.run('b', request(exe))]);
    assert.equal(a?.length, 1);
    assert.equal(b?.length, 1);
  });
});
