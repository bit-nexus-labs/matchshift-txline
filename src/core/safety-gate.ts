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
    return { trustedRecords: [], status: { active: false } };
  }

  const trustedRecords: MatchRecord[] = [];
  let expectedSyntheticSequence = expectedFirstSequence;
  let expectedScoreSequence: number | undefined;
  let syntheticHoldReason: string | undefined;
  let syntheticBlockedFrom: number | undefined;
  let syntheticRecoveredAt: number | undefined;
  let scoreHoldReason: string | undefined;
  let scoreBlockedFrom: number | undefined;
  let scoreRecoveredAt: number | undefined;

  for (const record of visibleRecords) {
    if (record.sourceOrder?.domain === "TXLINE_ODDS") {
      trustedRecords.push(record);
      continue;
    }

    if (record.sourceOrder?.domain === "TXLINE_SCORES") {
      const sourceSequence = record.sourceOrder.sourceSequence;
      if (sourceSequence === undefined) {
        scoreHoldReason = "TxLINE score record had no observed source sequence.";
        continue;
      }

      if (scoreHoldReason !== undefined) {
        if (record.kind === "recovery") {
          trustedRecords.push(record);
          expectedScoreSequence = sourceSequence + 1;
          scoreRecoveredAt = sourceSequence;
          scoreHoldReason = undefined;
          scoreBlockedFrom = undefined;
        }
        continue;
      }

      if (expectedScoreSequence === undefined) {
        if (record.kind === "recovery") {
          trustedRecords.push(record);
          expectedScoreSequence = sourceSequence + 1;
        } else {
          scoreHoldReason = "TxLINE score stream has no trusted snapshot baseline.";
          scoreBlockedFrom = sourceSequence;
        }
        continue;
      }

      if (sourceSequence === expectedScoreSequence) {
        trustedRecords.push(record);
        expectedScoreSequence += 1;
        continue;
      }

      if (record.kind === "recovery") {
        trustedRecords.push(record);
        expectedScoreSequence = sourceSequence + 1;
        scoreRecoveredAt = sourceSequence;
        continue;
      }

      scoreBlockedFrom = expectedScoreSequence;
      scoreHoldReason =
        sourceSequence > expectedScoreSequence
          ? `TxLINE score sequence gap: expected ${expectedScoreSequence}, received ${sourceSequence}`
          : `Out-of-order or duplicate TxLINE score sequence: expected ${expectedScoreSequence}, received ${sourceSequence}`;
      continue;
    }

    const sequence = record.sequence;
    if (sequence === undefined) {
      syntheticHoldReason = "Synthetic record had no deterministic sequence.";
      continue;
    }

    if (expectedSyntheticSequence === undefined) {
      trustedRecords.push(record);
      expectedSyntheticSequence = sequence + 1;
      continue;
    }

    if (syntheticHoldReason !== undefined) {
      if (record.kind === "recovery") {
        trustedRecords.push(record);
        expectedSyntheticSequence = sequence + 1;
        syntheticRecoveredAt = sequence;
        syntheticHoldReason = undefined;
        syntheticBlockedFrom = undefined;
      }
      continue;
    }

    if (sequence === expectedSyntheticSequence) {
      trustedRecords.push(record);
      expectedSyntheticSequence += 1;
      continue;
    }

    if (record.kind === "recovery") {
      trustedRecords.push(record);
      expectedSyntheticSequence = sequence + 1;
      syntheticRecoveredAt = sequence;
      continue;
    }

    syntheticBlockedFrom = expectedSyntheticSequence;
    syntheticHoldReason =
      sequence > expectedSyntheticSequence
        ? `Sequence gap: expected ${expectedSyntheticSequence}, received ${sequence}`
        : `Out-of-order or duplicate sequence: expected ${expectedSyntheticSequence}, received ${sequence}`;
  }

  const reason = scoreHoldReason ?? syntheticHoldReason;
  const blockedFromSequence =
    scoreHoldReason === undefined ? syntheticBlockedFrom : scoreBlockedFrom;
  const recoveredAtSequence = scoreRecoveredAt ?? syntheticRecoveredAt;

  if (reason !== undefined) {
    return {
      trustedRecords,
      status: {
        active: true,
        reason,
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
