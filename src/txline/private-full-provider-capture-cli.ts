import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTxlineOrigin, type TxlineNetwork } from "./config.js";
import { buildScoreHistoryBuckets } from "./curated-replay-source.js";
import {
  TxlineCredentialError,
  TxlineCredentials,
  type FetchLike
} from "./credentials.js";
import { TxlineHttpClient, TxlineHttpError } from "./http-client.js";
import {
  historicalFixtureStartEpochDay,
  selectLatestHistoricalEligibleFixture
} from "./latest-historical-fixture.js";
import { normalizeFixtures } from "./normalizer.js";
import {
  assertPrivateCaptureOutputPath,
  defaultPrivateCapturePath,
  parsePrivateRawCaptureBody,
  type PrivateRawCaptureResponse
} from "./private-raw-capture.js";
import { sanitizedErrorMessage } from "./redaction.js";

const MINUTE_MS = 60_000;
const DEFAULT_WINDOW_MINUTES = 180;
const MAX_WINDOW_MINUTES = 350;
const OPENING_SNAPSHOT_OFFSETS_MS = [
  0,
  1_000,
  5_000,
  15_000,
  30_000,
  60_000,
  120_000
] as const;

type CaptureAccept = "application/json" | "text/event-stream";

interface PrivateCaptureFailure {
  label: string;
  method: "GET";
  path: string;
  accept: CaptureAccept;
  requestedAtUtc: string;
  error: string;
}

type PrivateCaptureEntry = PrivateRawCaptureResponse | PrivateCaptureFailure;

function readNetwork(value: string | undefined): TxlineNetwork {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "devnet") {
    return normalized;
  }
  throw new Error("TXLINE_NETWORK must be mainnet or devnet.");
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum?: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new Error(
      maximum === undefined
        ? `${name} must be a positive integer.`
        : `${name} must be a positive integer no greater than ${maximum}.`
    );
  }
  return parsed;
}

function addQuery(
  route: string,
  values: Readonly<Record<string, string | number>>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    query.set(key, String(value));
  }
  return `${route}?${query.toString()}`;
}

class PrivateRawRequester {
  readonly #apiOrigin: string;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: FetchLike;
  readonly #credentials: TxlineCredentials;

  constructor(options: {
    apiOrigin: string;
    apiToken: string;
    requestTimeoutMs: number;
    fetchFn?: FetchLike;
  }) {
    this.#apiOrigin = options.apiOrigin;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#credentials = new TxlineCredentials(options);
  }

  sanitize(value: string): string {
    return this.#credentials.sanitize(value);
  }

  async capture(
    label: string,
    requestPath: string,
    accept: CaptureAccept = "application/json"
  ): Promise<PrivateRawCaptureResponse> {
    const requestedAtUtc = new Date().toISOString();
    const signal = AbortSignal.timeout(this.#requestTimeoutMs);
    let attempts = 1;

    try {
      let response = await this.#requestOnce(requestPath, accept, false, signal);
      if (response.status === 401) {
        await response.body?.cancel();
        attempts = 2;
        response = await this.#requestOnce(requestPath, accept, true, signal);
      }

      const bodyText = await response.text();
      const contentType = response.headers.get("content-type") ?? undefined;
      const contentLengthHeader =
        response.headers.get("content-length") ?? undefined;

      return {
        label,
        method: "GET",
        path: requestPath,
        accept,
        requestedAtUtc,
        attempts,
        status: response.status,
        ok: response.ok,
        ...(contentType === undefined ? {} : { contentType }),
        ...(contentLengthHeader === undefined ? {} : { contentLengthHeader }),
        byteLength: Buffer.byteLength(bodyText, "utf8"),
        bodyText,
        parse: parsePrivateRawCaptureBody(bodyText, contentType)
      };
    } catch (error) {
      if (error instanceof TxlineCredentialError || error instanceof TxlineHttpError) {
        throw error;
      }
      if (signal.aborted) {
        throw new TxlineHttpError(
          "TIMEOUT",
          "TxLINE private capture request timed out."
        );
      }
      throw new TxlineHttpError(
        "NETWORK_ERROR",
        "TxLINE private capture request failed."
      );
    }
  }

  async #requestOnce(
    requestPath: string,
    accept: CaptureAccept,
    refreshGuestJwt: boolean,
    signal: AbortSignal
  ): Promise<Response> {
    const headers = await this.#credentials.buildDataHeaders(
      accept,
      refreshGuestJwt,
      signal
    );
    return this.#fetchFn(new URL(requestPath, this.#apiOrigin), {
      method: "GET",
      headers,
      signal
    });
  }
}

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  let requester: PrivateRawRequester | undefined;

  try {
    if (apiToken === "") {
      throw new Error("TXLINE_API_TOKEN is required.");
    }

    const network = readNetwork(env.TXLINE_NETWORK ?? env.TXLINE_MODE);
    const requestTimeoutMs = readPositiveInteger(
      env.TXLINE_REQUEST_TIMEOUT_MS,
      30_000,
      "TXLINE_REQUEST_TIMEOUT_MS"
    );
    const windowMinutes = readPositiveInteger(
      env.TXLINE_PRIVATE_CAPTURE_WINDOW_MINUTES,
      DEFAULT_WINDOW_MINUTES,
      "TXLINE_PRIVATE_CAPTURE_WINDOW_MINUTES",
      MAX_WINDOW_MINUTES
    );
    const outputPath = assertPrivateCaptureOutputPath(
      env.TXLINE_PRIVATE_CAPTURE_OUTPUT_PATH?.trim() ||
        defaultPrivateCapturePath()
    );

    const nowTimestamp = Date.now();
    const apiOrigin = resolveTxlineOrigin(network);
    const sourceOptions = { apiOrigin, apiToken, requestTimeoutMs };
    const fixtureStartEpochDay = historicalFixtureStartEpochDay(nowTimestamp);

    const fixtureClient = new TxlineHttpClient(sourceOptions);
    const fixturePayload = await fixtureClient.fetchFixturesSnapshotForDay(
      fixtureStartEpochDay
    );
    const fixtures = normalizeFixtures(fixturePayload);
    const fixture = selectLatestHistoricalEligibleFixture(fixtures, nowTimestamp);
    const probeEndTimestamp = Math.min(
      nowTimestamp,
      fixture.startTimestamp + windowMinutes * MINUTE_MS
    );
    const buckets = buildScoreHistoryBuckets(
      fixture.startTimestamp,
      probeEndTimestamp
    );

    requester = new PrivateRawRequester(sourceOptions);
    const entries: PrivateCaptureEntry[] = [];

    const capture = async (
      label: string,
      requestPath: string,
      accept: CaptureAccept = "application/json"
    ): Promise<void> => {
      try {
        entries.push(await requester?.capture(label, requestPath, accept));
      } catch (error) {
        const message = requester?.sanitize(
          sanitizedErrorMessage(error, [apiToken])
        ) ?? sanitizedErrorMessage(error, [apiToken]);
        entries.push({
          label,
          method: "GET",
          path: requestPath,
          accept,
          requestedAtUtc: new Date().toISOString(),
          error: message
        });
      }
    };

    await capture(
      "fixtures-snapshot-discovery",
      addQuery("/api/fixtures/snapshot", {
        startEpochDay: fixtureStartEpochDay
      })
    );

    const fixtureDate = new Date(fixture.startTimestamp);
    const fixtureEpochDay = Math.floor(fixture.startTimestamp / 86_400_000);
    await capture(
      "fixture-updates-start-hour",
      `/api/fixtures/updates/${fixtureEpochDay}/${fixtureDate.getUTCHours()}`
    );

    await capture(
      "scores-full-historical",
      `/api/scores/historical/${encodeURIComponent(String(fixture.fixtureId))}`
    );

    for (const bucket of buckets) {
      await capture(
        `scores-bucket-${bucket.epochDay}-${bucket.hourOfDay}-${bucket.interval}`,
        addQuery(
          `/api/scores/updates/${bucket.epochDay}/${bucket.hourOfDay}/${bucket.interval}`,
          { fixtureId: String(fixture.fixtureId) }
        )
      );
    }

    for (const offset of OPENING_SNAPSHOT_OFFSETS_MS) {
      await capture(
        `scores-opening-snapshot-plus-${offset}-ms`,
        addQuery(
          `/api/scores/snapshot/${encodeURIComponent(String(fixture.fixtureId))}`,
          { asOf: fixture.startTimestamp + offset }
        )
      );
    }

    await capture(
      "scores-end-snapshot",
      addQuery(
        `/api/scores/snapshot/${encodeURIComponent(String(fixture.fixtureId))}`,
        { asOf: probeEndTimestamp }
      )
    );
    await capture(
      "scores-latest-snapshot",
      `/api/scores/snapshot/${encodeURIComponent(String(fixture.fixtureId))}`
    );
    await capture(
      "scores-current-five-minute-updates",
      `/api/scores/updates/${encodeURIComponent(String(fixture.fixtureId))}`
    );

    await capture(
      "odds-end-snapshot",
      addQuery(
        `/api/odds/snapshot/${encodeURIComponent(String(fixture.fixtureId))}`,
        { asOf: probeEndTimestamp }
      )
    );
    await capture(
      "odds-latest-snapshot",
      `/api/odds/snapshot/${encodeURIComponent(String(fixture.fixtureId))}`
    );

    for (const bucket of buckets) {
      await capture(
        `odds-bucket-${bucket.epochDay}-${bucket.hourOfDay}-${bucket.interval}`,
        addQuery(
          `/api/odds/updates/${bucket.epochDay}/${bucket.hourOfDay}/${bucket.interval}`,
          { fixtureId: String(fixture.fixtureId) }
        )
      );
    }

    const document = {
      warning: "PRIVATE_PROVIDER_DATA_DO_NOT_PUBLISH_OR_COMMIT",
      formatVersion: 1,
      capturedAtUtc: new Date().toISOString(),
      network,
      apiOrigin,
      outputScope: {
        includesFullProviderBodies: true,
        includesRequestHeaders: false,
        includesApiToken: false,
        includesGuestJwt: false
      },
      target: {
        fixtureId: String(fixture.fixtureId),
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        homeParticipant: fixture.homeParticipant,
        awayParticipant: fixture.awayParticipant,
        participant1IsHome: fixture.participant1IsHome,
        startUtc: new Date(fixture.startTimestamp).toISOString(),
        historicalWindowClassification: "ELIGIBLE",
        captureEndUtc: new Date(probeEndTimestamp).toISOString(),
        windowMinutes
      },
      requestSummary: {
        total: entries.length,
        succeeded: entries.filter((entry) => "status" in entry).length,
        failed: entries.filter((entry) => "error" in entry).length
      },
      entries
    };

    const serialized = JSON.stringify(document, null, 2) + "\n";
    const sanitized = requester.sanitize(serialized);
    if (sanitized.includes(apiToken)) {
      throw new Error("Private capture credential redaction failed.");
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, sanitized, { encoding: "utf8", mode: 0o600 });

    process.stdout.write("TXLINE PRIVATE FULL PROVIDER CAPTURE: PASS\n");
    process.stdout.write(
      `Match: ${fixture.homeParticipant} vs ${fixture.awayParticipant}\n`
    );
    process.stdout.write(
      `Start UTC: ${new Date(fixture.startTimestamp).toISOString()}\n`
    );
    process.stdout.write(`Captured requests: ${entries.length}\n`);
    process.stdout.write(
      `Failed requests retained as metadata: ${entries.filter((entry) => "error" in entry).length}\n`
    );
    process.stdout.write(`Private output: ${path.relative(process.cwd(), outputPath)}\n`);
    process.stdout.write("Git status should remain clean because artifacts/private/ is ignored.\n");
  } catch (error) {
    const baseMessage = sanitizedErrorMessage(error, [apiToken]);
    const message = requester?.sanitize(baseMessage) ?? baseMessage;
    process.stderr.write(
      `TXLINE PRIVATE FULL PROVIDER CAPTURE: FAIL (${message})\n`
    );
    process.exitCode = 1;
  }
}

await main();
