import * as assert from 'node:assert/strict';
import { Analyser, lineIndex } from '../../src/analyser';
import { Runner, RunRequest } from '../../src/runner';
import { Finding } from '../../src/sarif';

const request: RunRequest = { documentPath: '/p/A.php', text: '', executable: 'x', configFile: '' };
const finding: Finding = { line: 1, message: 'm', level: 'warning', ruleId: 'r' };

const unexpected = (message: string): void => {
  assert.fail(`unexpected error report: ${message}`);
};

type Outcome = Finding[] | undefined | Error;

/** Runner stub: resolves queued outcomes in order. */
function stubRunner(outcomes: Outcome[], onRun?: () => Promise<void>): Runner {
  return {
    cancel: () => undefined,
    run: async () => {
      await onRun?.();
      const outcome = outcomes.shift();
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    },
  } as unknown as Runner;
}

describe('lineIndex', () => {
  it('converts to 0-based', () => {
    assert.equal(lineIndex(12, 100), 11);
  });

  it('clamps lines past the end of the document', () => {
    assert.equal(lineIndex(50, 10), 9);
  });

  it('never goes negative', () => {
    assert.equal(lineIndex(0, 10), 0);
    assert.equal(lineIndex(-3, 10), 0);
    assert.equal(lineIndex(1, 0), 0);
  });
});

describe('Analyser', () => {
  it('returns findings while the result is current', async () => {
    const analyser = new Analyser(stubRunner([[finding]]), unexpected);
    assert.deepEqual(await analyser.analyse('k', request, () => true), [finding]);
  });

  it('drops a result that became stale while the run was in flight', async () => {
    let version = 1;
    const started = version;
    const analyser = new Analyser(
      stubRunner([[finding]], async () => { version += 1; await Promise.resolve(); }),
      unexpected,
    );
    assert.equal(await analyser.analyse('k', request, () => version === started), undefined);
  });

  it('returns undefined for cancelled runs without reporting an error', async () => {
    const analyser = new Analyser(stubRunner([undefined]), unexpected);
    assert.equal(await analyser.analyse('k', request, () => true), undefined);
  });

  it('reports an identical error only once', async () => {
    const seen: string[] = [];
    const analyser = new Analyser(
      stubRunner([new Error('boom'), new Error('boom'), new Error('other')]),
      (message) => seen.push(message),
    );
    for (let i = 0; i < 3; i += 1) {
      assert.equal(await analyser.analyse('k', request, () => true), undefined);
    }
    assert.deepEqual(seen, ['boom', 'other']);
  });

  it('reports again after a success or a reset', async () => {
    const seen: string[] = [];
    const analyser = new Analyser(
      stubRunner([new Error('boom'), [], new Error('boom'), new Error('boom')]),
      (message) => seen.push(message),
    );
    await analyser.analyse('k', request, () => true);
    await analyser.analyse('k', request, () => true);
    await analyser.analyse('k', request, () => true);
    analyser.resetErrors();
    await analyser.analyse('k', request, () => true);
    assert.deepEqual(seen, ['boom', 'boom', 'boom']);
  });

  it('bounds the remembered errors', async () => {
    const seen: string[] = [];
    const errors = Array.from({ length: 120 }, (_, i) => new Error(`e${String(i)}`));
    const analyser = new Analyser(stubRunner(errors), (message) => seen.push(message));
    for (let i = 0; i < 120; i += 1) {
      await analyser.analyse('k', request, () => true);
    }
    assert.equal(seen.length, 120);
  });
});
