import { summarizeHistoricalPayloadShape } from "./historical-shape-probe.js";
import {
  normalizeScorePayload,
  type NormalizedFixture,
  type NormalizationDiagnosticCode,
  type NormalizationIssueCode
} from "./normalizer.js";

const MAX_REPORTED_PATHS = 80;
const SCORE_PATH_PATTERN =
  /(?:^|\.)(?:scoreSoccer|ScoreSoccer|score|Score|dataSoccer|DataSoccer|data|Data|action|Action|seq|Seq|ts|Ts|Participant1|Participant2|Total|Goals)(?:$|[.<\[])/;

export interface ScoreSchemaPathSummary {
  path: string;
  count: number;
  types: readonly string[];
}

export interface ScoreRecordShapeDiagnostics {
  recordCount: number;
  recoveryCount: number;
  issueCounts: Readonly<Record<NormalizationIssueCode, number>>;
  diagnosticCounts: Readonly<Record<NormalizationDiagnosticCode, number>>;
  schemaPaths: readonly ScoreSchemaPathSummary[];
  schemaPathsTruncated: boolean;
}

function increment<T extends string>(target: Map<T, number>, key: T): void {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function sortedRecord<T extends string>(source: Map<T, number>): Readonly<Record<T, number>> {
  return Object.fromEntries(
    [...source.entries()].sort(([left], [right]) => left.localeCompare(right))
  ) as Readonly<Record<T, number>>;
}

export function diagnoseScoreRecordShape(
  records: readonly unknown[],
  fixture: NormalizedFixture,
  receivedTimestamp: number
): ScoreRecordShapeDiagnostics {
  const issueCounts = new Map<NormalizationIssueCode, number>();
  const diagnosticCounts = new Map<NormalizationDiagnosticCode, number>();
  let recoveryCount = 0;

  for (const record of records) {
    const normalized = normalizeScorePayload(record, {
      fixture,
      receivedTimestamp,
      snapshot: true
    });
    recoveryCount += normalized.records.filter((item) => item.kind === "recovery").length;
    for (const issue of normalized.issues) {
      increment(issueCounts, issue.code);
    }
    for (const diagnostic of normalized.diagnostics) {
      increment(diagnosticCounts, diagnostic.code);
    }
  }

  const shape = summarizeHistoricalPayloadShape(records, {
    status: 200,
    contentType: "application/json",
    byteLength: 0
  });
  const matchingPaths = shape.paths.filter((item) => SCORE_PATH_PATTERN.test(item.path));

  return {
    recordCount: records.length,
    recoveryCount,
    issueCounts: sortedRecord(issueCounts),
    diagnosticCounts: sortedRecord(diagnosticCounts),
    schemaPaths: matchingPaths.slice(0, MAX_REPORTED_PATHS),
    schemaPathsTruncated:
      shape.truncated || matchingPaths.length > MAX_REPORTED_PATHS
  };
}

function formatCounts(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values);
  return entries.length === 0
    ? "NONE"
    : entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

export function formatScoreRecordShapeDiagnostics(
  diagnostics: ScoreRecordShapeDiagnostics
): string {
  const lines = [
    `Score normalization diagnostics: records=${diagnostics.recordCount}; recoveries=${diagnostics.recoveryCount}`,
    `Normalization issues: ${formatCounts(diagnostics.issueCounts)}`,
    `Normalization diagnostics: ${formatCounts(diagnostics.diagnosticCounts)}`,
    `Score schema paths: count=${diagnostics.schemaPaths.length}; truncated=${diagnostics.schemaPathsTruncated}`
  ];

  for (const item of diagnostics.schemaPaths) {
    lines.push(
      `${item.path} | types=${item.types.join(",")} | count=${item.count}`
    );
  }

  return `${lines.join("\n")}\n`;
}
