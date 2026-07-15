import type { MatchRecord, SafetyStatus } from "./types.js";

export interface SafetyGateResult {
  trustedRecords: MatchRecord[];
  status: SafetyStatus;
}

export function applySequenceSafetyGate(
  visibleRecords: readonly MatchRecord[],
  expectedFirstSequence?: number
): SafetyGateResult {
  if (visibleRecords.length === 0) {
    return {
      trustedRecords: [],
      status: { active: false }
    };
  }

  const trustedRecords: MatchRecord[] = [];
  let expectedSequence = expectedFirstSequence;
  let holdReason: string | undefined;
  let blockedFromSequence: number | undefined;
  let recoveredAtSequence: number | undefined;

  for (const record of visibleRecords) {
    if (expectedSequence === undefined) {
      trustedRecords.push(record);
      expectedSequence = record.sequence + 1;
      continue;
    }

    if (holdReason !== undefined) {
      if (record.kind === "recovery") {
        trustedRecords.push(record);
        expectedSequence = record.sequence + 1;
        recoveredAtSequence = record.sequence;
        holdReason = undefined;
        blockedFromSequence = undefined;
      }
      continue;
    }

    if (record.sequence === expectedSequence) {
      trustedRecords.push(record);
      expectedSequence += 1;
      continue;
    }

    if (record.kind === "recovery") {
      trustedRecords.push(record);
      expectedSequence = record.sequence + 1;
      recoveredAtSequence = record.sequence;
      continue;
    }

    blockedFromSequence = expectedSequence;
    holdReason =
      record.sequence > expectedSequence
        ? `Sequence gap: expected ${expectedSequence}, received ${record.sequence}`
        : `Out-of-order or duplicate sequence: expected ${expectedSequence}, received ${record.sequence}`;
  }

  if (holdReason !== undefined) {
    return {
      trustedRecords,
      status: {
        active: true,
        reason: holdReason,
        ...(blockedFromSequence === undefined ? {} : { blockedFromSequence }),
        ...(recoveredAtSequence === undefined ? {} : { recoveredAtSequence })
      }
    };
  }

  return {
    trustedRecords,
    status: {
      active: false,
      ...(recoveredAtSequence === undefined ? {} : { recoveredAtSequence })
    }
  };
}
