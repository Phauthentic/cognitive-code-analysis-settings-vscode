import { Runner, RunRequest } from './runner';
import { Finding } from './sarif';

const MAX_REMEMBERED_ERRORS = 50;

/** 0-based line index for a 1-based SARIF line, clamped into the document. */
export function lineIndex(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, lineCount) - 1);
}

/**
 * Wraps the runner with the two rules that keep diagnostics trustworthy:
 * a result is only returned while the caller still considers it current, and a failure is reported once.
 */
export class Analyser {
  private readonly reported = new Set<string>();

  constructor(
    private readonly runner: Runner,
    private readonly onError: (message: string) => void,
  ) {}

  cancel(key: string): void {
    this.runner.cancel(key);
  }

  /** Forget reported errors so the next failure is shown again (call on configuration change). */
  resetErrors(): void {
    this.reported.clear();
  }

  /** Findings, or `undefined` when cancelled, stale (`isCurrent()` is false after the run) or failed. */
  async analyse(key: string, request: RunRequest, isCurrent: () => boolean): Promise<Finding[] | undefined> {
    try {
      const findings = await this.runner.run(key, request);
      if (findings === undefined || !isCurrent()) {
        return undefined;
      }
      this.reported.clear();
      return findings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.reported.has(message)) {
        if (this.reported.size >= MAX_REMEMBERED_ERRORS) {
          this.reported.clear();
        }
        this.reported.add(message);
        this.onError(message);
      }
      return undefined;
    }
  }
}
