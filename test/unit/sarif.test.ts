import * as assert from 'node:assert/strict';
import { sarifToFindings } from '../../src/sarif';

function sarif(results: unknown[]): unknown {
  return { version: '2.1.0', runs: [{ results }] };
}

function result(line: unknown, level: unknown = 'warning', text: unknown = 'Method x has cognitive complexity 2.0 (threshold: 1.0)'): unknown {
  return {
    ruleId: 'cognitive-complexity',
    level,
    message: { text },
    locations: [{ physicalLocation: { region: { startLine: line } } }],
  };
}

describe('sarifToFindings', () => {
  it('maps phpcca results', () => {
    assert.deepEqual(sarifToFindings(sarif([result(12, 'error')])), [
      {
        line: 12,
        level: 'error',
        ruleId: 'cognitive-complexity',
        message: 'Method x has cognitive complexity 2.0 (threshold: 1.0)',
      },
    ]);
  });

  it('keeps note level and falls back to warning for unknown levels', () => {
    const findings = sarifToFindings(sarif([result(1, 'note'), result(2, 'bogus'), result(3, undefined)]));
    assert.deepEqual(findings.map((f) => f.level), ['note', 'warning', 'warning']);
  });

  it('returns nothing for an empty report', () => {
    assert.deepEqual(sarifToFindings(sarif([])), []);
  });

  it('defaults the rule id when missing', () => {
    const noRule = { message: { text: 'm' }, locations: [{ physicalLocation: { region: { startLine: 3 } } }] };
    assert.equal(sarifToFindings(sarif([noRule]))[0]?.ruleId, 'cognitive-complexity');
  });

  it('skips malformed results but keeps valid ones', () => {
    const findings = sarifToFindings(
      sarif([null, 'x', result(0), result(1.5), result('3'), result(4, 'warning', 5), { message: { text: 'm' } }, result(7)]),
    );
    assert.deepEqual(findings.map((f) => f.line), [7]);
  });

  it('does not throw on non-SARIF input', () => {
    for (const input of [undefined, null, 42, 'text', [], {}, { runs: 'x' }, { runs: [null, { results: 'x' }] }]) {
      assert.deepEqual(sarifToFindings(input), []);
    }
  });
});
