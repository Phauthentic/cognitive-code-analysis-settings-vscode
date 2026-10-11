export type FindingLevel = 'error' | 'warning' | 'note';

export interface Finding {
  /** 1-based line of the method declaration. */
  line: number;
  message: string;
  level: FindingLevel;
  ruleId: string;
}

const DEFAULT_RULE_ID = 'cognitive-complexity';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toLevel(value: unknown): FindingLevel {
  return value === 'error' || value === 'note' ? value : 'warning';
}

function toFinding(result: unknown): Finding | undefined {
  if (!isRecord(result) || !isRecord(result.message) || typeof result.message.text !== 'string') {
    return undefined;
  }
  const locations = result.locations;
  const location: unknown = Array.isArray(locations) ? locations[0] : undefined;
  const physical = isRecord(location) ? location.physicalLocation : undefined;
  const region = isRecord(physical) ? physical.region : undefined;
  const line = isRecord(region) ? region.startLine : undefined;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    return undefined;
  }
  return {
    line,
    message: result.message.text,
    level: toLevel(result.level),
    ruleId: typeof result.ruleId === 'string' ? result.ruleId : DEFAULT_RULE_ID,
  };
}

/** Maps a parsed SARIF document to findings. Anything malformed is skipped, never thrown. */
export function sarifToFindings(sarif: unknown): Finding[] {
  if (!isRecord(sarif) || !Array.isArray(sarif.runs)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const run of sarif.runs as unknown[]) {
    if (!isRecord(run) || !Array.isArray(run.results)) {
      continue;
    }
    for (const result of run.results as unknown[]) {
      const finding = toFinding(result);
      if (finding) {
        findings.push(finding);
      }
    }
  }
  return findings;
}
