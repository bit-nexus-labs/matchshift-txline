import { writeFile } from "node:fs/promises";
import type { MatchScoreCoverage } from "../core/types.js";
import {
  exportCuratedCompletedMatch,
  type CuratedReplayExportOptions,
  type CuratedReplayExportResult
} from "./curated-replay-exporter.js";
import {
  applyDisclosedPartialCoverage,
  renderDisclosedCuratedReplayModule
} from "./curated-partial-artifact.js";
import type { CuratedPartialReplaySource } from "./curated-partial-replay-source.js";

export interface CuratedPartialExportResult extends CuratedReplayExportResult {
  scoreCoverage?: MatchScoreCoverage;
}

function renderCoverageReceipt(
  receipt: string,
  coverage: MatchScoreCoverage
): string {
  const lines = receipt.trimEnd().split("\n");
  const generatedIndex = lines.findIndex((line) => line.startsWith("Generated module:"));
  const disclosure = [
    "Score history coverage: PARTIAL_OPENING",
    "Opening baseline provenance: LOCAL_STRUCTURAL_0_0",
    `Trusted TxLINE score coverage begins at UTC: ${new Date(coverage.providerScoreStartTimestamp).toISOString()}`,
    "Missing provider opening events represented as a disclosed recovery gap: YES",
    ""
  ];
  if (generatedIndex < 0) {
    return [...lines, "", ...disclosure].join("\n");
  }
  lines.splice(generatedIndex, 0, ...disclosure);
  return `${lines.join("\n")}\n`;
}

export async function exportCuratedCompletedMatchWithDisclosure(
  options: Omit<CuratedReplayExportOptions, "client"> & {
    client: CuratedPartialReplaySource;
  }
): Promise<CuratedPartialExportResult> {
  const result = await exportCuratedCompletedMatch(options);
  const marker = options.client.getScoreCoverage();
  if (marker === undefined) {
    return result;
  }

  const coverage: MatchScoreCoverage = {
    scoreHistory: "PARTIAL_OPENING",
    providerScoreStartTimestamp: marker.providerScoreStartTimestamp,
    openingBaseline: "LOCAL_STRUCTURAL_0_0"
  };
  const match = applyDisclosedPartialCoverage(result.match, coverage);
  await writeFile(
    result.outputPath,
    renderDisclosedCuratedReplayModule(match),
    { encoding: "utf8" }
  );
  const receipt = renderCoverageReceipt(result.receipt, coverage);
  await writeFile(result.receiptPath, receipt, {
    encoding: "utf8",
    mode: 0o600
  });
  return {
    ...result,
    match,
    receipt,
    scoreCoverage: coverage
  };
}
