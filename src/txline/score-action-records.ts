const MAX_SCORE_ACTION_UNWRAP_DEPTH = 12;
const MAX_SCORE_ACTION_UNWRAP_NODES = 250_000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function hasAnyKey(record: UnknownRecord, keys: readonly string[]): boolean {
  return keys.some((key) => Object.hasOwn(record, key));
}

function isDirectScoreActionRecord(record: UnknownRecord): boolean {
  return (
    hasAnyKey(record, ["fixtureId", "FixtureId"]) &&
    hasAnyKey(record, ["seq", "Seq"]) &&
    hasAnyKey(record, ["ts", "Ts"]) &&
    hasAnyKey(record, ["action", "Action"])
  );
}

function canonicalizeScoreActionRecord(record: UnknownRecord): UnknownRecord {
  const scoreSoccer =
    record.scoreSoccer ?? record.ScoreSoccer ?? record.score ?? record.Score;
  const dataSoccer =
    record.dataSoccer ?? record.DataSoccer ?? record.data ?? record.Data;
  const alreadyHasScoreAlias = hasAnyKey(record, ["scoreSoccer", "ScoreSoccer"]);
  const alreadyHasDataAlias = hasAnyKey(record, ["dataSoccer", "DataSoccer"]);

  return {
    ...record,
    ...(alreadyHasScoreAlias || scoreSoccer === undefined ? {} : { scoreSoccer }),
    ...(alreadyHasDataAlias || dataSoccer === undefined ? {} : { dataSoccer })
  };
}

function tryParseNestedJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    trimmed.length < 2 ||
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function extractTxlineScoreActionRecords(payload: unknown): unknown[] {
  const records: unknown[] = [];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  const visit = (value: unknown, depth: number): void => {
    visitedNodes += 1;
    if (
      visitedNodes > MAX_SCORE_ACTION_UNWRAP_NODES ||
      depth > MAX_SCORE_ACTION_UNWRAP_DEPTH
    ) {
      return;
    }

    if (typeof value === "string") {
      const nested = tryParseNestedJson(value);
      if (nested !== undefined) {
        visit(nested, depth + 1);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    const record = asRecord(value);
    if (record === undefined || seen.has(record)) {
      return;
    }
    seen.add(record);

    if (isDirectScoreActionRecord(record)) {
      records.push(canonicalizeScoreActionRecord(record));
      return;
    }

    for (const nested of Object.values(record)) {
      visit(nested, depth + 1);
    }
  };

  visit(payload, 0);
  return records;
}
