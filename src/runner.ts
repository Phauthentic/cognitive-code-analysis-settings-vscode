import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Finding, sarifToFindings } from './sarif';

export const DEFAULT_EXECUTABLE = 'vendor/bin/phpcca';
const FALLBACK_EXECUTABLE = 'phpcca';
const CONFIG_FILENAME = 'phpcca.yaml';
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PHP_EXECUTABLE = 'php';

export interface RunRequest {
  /** Absolute path of the document on disk (may not exist yet or differ from `text`). */
  documentPath: string;
  /** Current buffer content, including unsaved edits. */
  text: string;
  /** Workspace folder the document belongs to, if any. Used to resolve settings and the mirrored path. */
  workspaceFolder?: string;
  /** Value of the `phpcca.executable` setting. */
  executable: string;
  /** Value of the `phpcca.configFile` setting (empty = auto). */
  configFile: string;
  /** Value of the `phpcca.phpExecutable` setting, used on Windows only. */
  phpExecutable?: string;
}

export function resolveExecutable(
  setting: string,
  workspaceFolder: string | undefined,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const candidate = path.isAbsolute(setting)
    ? setting
    : workspaceFolder !== undefined
      ? path.resolve(workspaceFolder, setting)
      : undefined;
  if (candidate !== undefined && exists(candidate)) {
    return candidate;
  }
  return setting === DEFAULT_EXECUTABLE ? FALLBACK_EXECUTABLE : setting;
}

export function resolveConfigFile(
  setting: string,
  workspaceFolder: string | undefined,
  exists: (p: string) => boolean = fs.existsSync,
): string | undefined {
  if (setting !== '') {
    return path.resolve(workspaceFolder ?? '.', setting);
  }
  if (workspaceFolder === undefined) {
    return undefined;
  }
  const implicit = path.join(workspaceFolder, CONFIG_FILENAME);
  return exists(implicit) ? implicit : undefined;
}

export function buildArgs(phpFile: string, sarifFile: string, configFile?: string): string[] {
  const args = ['analyse', phpFile, '-r', 'sarif', '-f', sarifFile];
  if (configFile !== undefined) {
    args.push('-c', configFile);
  }
  return args;
}

export interface Command {
  file: string;
  args: string[];
}

/**
 * On Windows the phpcca "executable" is a PHP script without a usable shebang and Node refuses to spawn .bat files
 * without a shell, so it is run through `php`. Elsewhere it is executed directly. A shell is never used.
 */
export function buildCommand(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  phpExecutable: string = DEFAULT_PHP_EXECUTABLE,
): Command {
  return platform === 'win32'
    ? { file: phpExecutable, args: [executable, ...args] }
    : { file: executable, args };
}

/**
 * Location of the temp copy relative to the temp dir.
 * Mirroring the workspace-relative path keeps `excludeFilePatterns` of the phpcca config effective.
 */
export function tempRelativePath(documentPath: string, workspaceFolder?: string): string {
  if (workspaceFolder !== undefined) {
    const relative = path.relative(workspaceFolder, documentPath);
    const outside =
      relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
    if (!outside) {
      return relative;
    }
  }
  return path.basename(documentPath);
}

export function describeFailure(error: Error & { stderr?: string }): string {
  const stderr = (error.stderr ?? '').trim();
  return stderr === '' || error.message.includes(stderr) ? error.message : `${error.message}\n${stderr}`;
}

export interface RunnerOptions {
  /** Directory for per-run temp dirs. Defaults to the OS temp dir. */
  tempRoot?: string;
  platform?: NodeJS.Platform;
  maxOutputBytes?: number;
}

/** Runs phpcca on buffer contents. One in-flight run per key (document); a new run cancels the previous one. */
export class Runner {
  private readonly inFlight = new Map<string, AbortController>();
  private readonly tempRoot: string;
  private readonly platform: NodeJS.Platform;
  private readonly maxOutputBytes: number;

  constructor(options: RunnerOptions = {}) {
    this.tempRoot = options.tempRoot ?? os.tmpdir();
    this.platform = options.platform ?? process.platform;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  cancel(key: string): void {
    this.inFlight.get(key)?.abort();
    this.inFlight.delete(key);
  }

  /**
   * Resolves to `undefined` when the run was cancelled. Rejects when phpcca fails without a report.
   * Error messages never contain the temp dir, so identical problems yield identical messages.
   */
  async run(key: string, request: RunRequest): Promise<Finding[] | undefined> {
    this.cancel(key);
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    try {
      return await this.execute(request, controller.signal);
    } finally {
      if (this.inFlight.get(key) === controller) {
        this.inFlight.delete(key);
      }
    }
  }

  private async execute(request: RunRequest, signal: AbortSignal): Promise<Finding[] | undefined> {
    const tempDir = await fs.promises.mkdtemp(path.join(this.tempRoot, 'phpcca-'));
    const phpFile = path.join(tempDir, tempRelativePath(request.documentPath, request.workspaceFolder));
    const sanitize = (text: string): string =>
      text.split(phpFile).join(request.documentPath).split(tempDir).join('<tmp>');
    // A function, so TypeScript does not narrow the flag after the first check.
    const cancelled = (): boolean => signal.aborted;
    try {
      const sarifFile = path.join(tempDir, 'report.sarif');
      await fs.promises.mkdir(path.dirname(phpFile), { recursive: true });
      await fs.promises.writeFile(phpFile, request.text);

      const executable = resolveExecutable(request.executable, request.workspaceFolder);
      const configFile = resolveConfigFile(request.configFile, request.workspaceFolder);
      const command = buildCommand(
        executable,
        buildArgs(phpFile, sarifFile, configFile),
        this.platform,
        request.phpExecutable,
      );

      // cwd is the temp dir on purpose: phpcca writes its ./.phpcca.cache relative to cwd, which must never be the
      // user's project. The config is therefore always passed as an absolute -c path.
      const failure = await new Promise<Error | undefined>((resolve) => {
        execFile(
          command.file,
          command.args,
          { cwd: tempDir, signal, maxBuffer: this.maxOutputBytes },
          (error) => { resolve(error ?? undefined); },
        );
      });
      if (cancelled()) {
        return undefined;
      }

      // phpcca may exit non-zero yet still have written a valid report, so the report decides.
      let json: unknown;
      try {
        const raw = await fs.promises.readFile(sarifFile, 'utf8');
        if (cancelled()) {
          return undefined;
        }
        json = JSON.parse(raw);
      } catch (readError) {
        const reason = failure
          ? describeFailure(failure)
          : `phpcca produced no readable SARIF report (${readError instanceof Error ? readError.message : String(readError)})`;
        throw new Error(sanitize(reason), { cause: readError });
      }
      return sarifToFindings(json);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}
