import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import { exportCuratedCompletedMatchWithDisclosure } from "./curated-partial-exporter.js";
import { createCuratedPartialReplaySource } from "./curated-partial-replay-source.js";
import { exportCuratedCompletedMatch } from "./curated-replay-exporter.js";
import { createCuratedReplaySource } from "./curated-replay-source.js";
import { CuratedReplayError, type CuratedFixtureSelector } from "./curated-replay.js";
import { createPrivateCaptureCuratedReplaySource } from "./private-capture-curated-replay-source.js";
import { sanitizedErrorMessage } from "./redaction.js";

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new CuratedReplayError(
    "CURATED_NETWORK_INVALID",
    "TXLINE_NETWORK must be mainnet or devnet."
  );
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CuratedReplayError(
      "CURATED_CONFIGURATION_INVALID",
      `${name} must be a positive integer.`
    );
  }
  return parsed;
}

function readBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? ""
  );
}

function selectorFromEnvironment(
  env: Readonly<Record<string, string | undefined>>
): CuratedFixtureSelector {
  const fixtureId = env.TXLINE_CURATED_FIXTURE_ID?.trim();
  if (fixtureId !== undefined && fixtureId !== "") {
    return { fixtureId };
  }
  const sideA = env.TXLINE_CURATED_SIDE_A?.trim();
  const sideB = env.TXLINE_CURATED_SIDE_B?.trim();
  if (
    sideA === undefined ||
    sideA === "" ||
    sideB === undefined ||
    sideB === ""
  ) {
    throw new CuratedReplayError(
      "CURATED_SIDES_REQUIRED",
      "TXLINE_CURATED_SIDE_A and TXLINE_CURATED_SIDE_B are required when no fixture identifier is provided."
    );
  }
  const matchDateUtc = env.TXLINE_CURATED_MATCH_DATE_UTC?.trim();
  return {
    sideA,
    sideB,
    ...(matchDateUtc === undefined || matchDateUtc === ""
      ? {}
      : { matchDateUtc })
  };
}

export async function curatedReplayExportCli(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  const privateCapturePath =
    env.TXLINE_CURATED_PRIVATE_CAPTURE_PATH?.trim() ?? "";
  try {
    if (apiToken === "" && privateCapturePath === "") {
      throw new CuratedReplayError(
        "CURATED_TOKEN_REQUIRED",
        "TXLINE_API_TOKEN is required unless TXLINE_CURATED_PRIVATE_CAPTURE_PATH is provided."
      );
    }
    const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
    const publicFixtureId =
      env.TXLINE_CURATED_PUBLIC_FIXTURE_ID?.trim() ||
      "curated-completed-match";
    const publicLabel =
      env.TXLINE_CURATED_PUBLIC_LABEL?.trim() ||
      "Curated TxLINE completed-match replay";
    const requestTimeoutMs = readPositiveInteger(
      env.TXLINE_REQUEST_TIMEOUT_MS,
      30_000,
      "TXLINE_REQUEST_TIMEOUT_MS"
    );
    const durationMinutes = readPositiveInteger(
      env.TXLINE_CURATED_DURATION_MINUTES,
      120,
      "TXLINE_CURATED_DURATION_MINUTES"
    );
    const outputPath = env.TXLINE_CURATED_OUTPUT_PATH?.trim();
    const receiptPath = env.TXLINE_CURATED_RECEIPT_PATH?.trim();
    const competitionId = env.TXLINE_COMPETITION_ID?.trim();
    const exportOptions = {
      network,
      selector: selectorFromEnvironment(env),
      publicFixtureId,
      publicLabel,
      durationMinutes,
      oddsSampleMinutes: readPositiveInteger(
        env.TXLINE_CURATED_ODDS_SAMPLE_MINUTES,
        10,
        "TXLINE_CURATED_ODDS_SAMPLE_MINUTES"
      ),
      requireOdds: readBoolean(env.TXLINE_CURATED_REQUIRE_ODDS),
      ...(outputPath === undefined || outputPath === "" ? {} : { outputPath }),
      ...(receiptPath === undefined || receiptPath === ""
        ? {}
        : { receiptPath }),
      ...(competitionId === undefined || competitionId === ""
        ? {}
        : { competitionId })
    };

    const allowPartialOpening = readBoolean(
      env.TXLINE_CURATED_ALLOW_PARTIAL_OPENING
    );
    if (privateCapturePath !== "" && allowPartialOpening) {
      throw new CuratedReplayError(
        "CURATED_CONFIGURATION_INVALID",
        "Private full capture export requires complete score lifecycle recovery and cannot enable partial opening disclosure."
      );
    }

    const privateClient =
      privateCapturePath === ""
        ? undefined
        : await createPrivateCaptureCuratedReplaySource({
            inputPath: privateCapturePath,
            expectedNetwork: network
          });
    const sourceOptions = {
      apiOrigin: resolveTxlineOrigin(network),
      apiToken,
      requestTimeoutMs
    };
    const result = allowPartialOpening
      ? await exportCuratedCompletedMatchWithDisclosure({
          ...exportOptions,
          client: createCuratedPartialReplaySource({
            ...sourceOptions,
            fallbackHistoryDurationMinutes: durationMinutes
          })
        })
      : await exportCuratedCompletedMatch({
          ...exportOptions,
          client:
            privateClient ?? createCuratedReplaySource(sourceOptions)
        });

    process.stdout.write("TXLINE CURATED COMPLETED-MATCH EXPORT: PASS\n");
    process.stdout.write(
      `Source: ${privateClient === undefined ? "authenticated TxLINE" : "private full capture"}\n`
    );
    process.stdout.write(`Generated module: ${result.outputPath}\n`);
    process.stdout.write(`Private receipt: ${result.receiptPath}\n`);
    process.stdout.write(
      `Curated records: ${result.match.records.length}; normalized odds records: ${result.oddsRecordCount}\n`
    );
    if (result.match.coverage?.scoreHistory === "PARTIAL_OPENING") {
      const minutes =
        (result.match.coverage.providerScoreStartTimestamp -
          result.match.kickoffTimestamp) /
        60_000;
      process.stdout.write(
        `Score coverage: PARTIAL_OPENING; trusted TxLINE score archive begins at +${minutes.toFixed(1)}m.\n`
      );
    }
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(
      `TXLINE CURATED COMPLETED-MATCH EXPORT: FAIL (${message})\n`
    );
    process.exitCode = 1;
  }
}

await curatedReplayExportCli();
