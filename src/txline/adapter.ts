import type { MatchDefinition, MatchRecord } from "../core/types.js";
import type {
  DataSourceStatus,
  MatchDataSource
} from "../data-source/types.js";
import type { FetchLike } from "./credentials.js";
import type { TxlineNetwork, TxlineRuntimeConfig } from "./config.js";
import {
  TxlineConfigurationError,
  TxlineHttpClient,
  TxlineHttpError,
  type TxlineStreamKind
} from "./http-client.js";
import {
  normalizeFixtures,
  normalizeOddsPayload,
  normalizePayloads,
  normalizeScorePayload,
  type NormalizedFixture,
  type NormalizeRecordOptions
} from "./normalizer.js";
import { sanitizedErrorMessage } from "./redaction.js";
import { readSseFrames } from "./sse-parser.js";

export interface TxlineClient {
  fetchFixturesSnapshot(
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<unknown>;
  fetchOddsSnapshot(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown>;
  fetchScoresSnapshot(
    fixtureId: string | number,
    signal?: AbortSignal
  ): Promise<unknown>;
  openStream(
    kind: TxlineStreamKind,
    signal?: AbortSignal
  ): Promise<Response>;
}

export interface TxlineAdapterConfig extends TxlineRuntimeConfig {
  mode: TxlineNetwork;
  network: TxlineNetwork;
}

export interface TxlineAdapterOptions {
  config: TxlineAdapterConfig;
  client?: TxlineClient;
  fetchFn?: FetchLike;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface RunStreamOptions {
  fixtureId: string;
  signal?: AbortSignal;
  maxReconnectAttempts?: number;
  onRecord?: (record: MatchRecord) => void | Promise<void>;
}

function sleepWithSignal(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export function computeReconnectDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const exponent = Math.min(attempt, 30);
  const ceiling = Math.min(maxMs, baseMs * 2 ** exponent);
  const jitterFactor = 0.75 + Math.max(0, Math.min(1, random())) * 0.25;
  return Math.max(1, Math.min(maxMs, Math.floor(ceiling * jitterFactor)));
}

export class TxlineAdapter implements MatchDataSource {
  readonly mode: TxlineNetwork;
  readonly #config: TxlineAdapterConfig;
  readonly #client: TxlineClient | undefined;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #sleep: (
    milliseconds: number,
    signal?: AbortSignal
  ) => Promise<void>;
  #status: DataSourceStatus;
  #matches: MatchDefinition[] = [];
  #fixtures = new Map<string, NormalizedFixture>();
  #streamPositions = new Map<
    string,
    { sequence: number; sourceTimestamp: number; recordId: string }
  >();

  constructor(options: TxlineAdapterOptions) {
    this.#config = options.config;
    this.mode = options.config.mode;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? sleepWithSignal;

    const configurationError =
      options.config.configurationError ??
      (options.config.apiOrigin === undefined ||
      options.config.apiToken === undefined
        ? "TxLINE mode requires a fixed network host and API token."
        : undefined);
    if (configurationError !== undefined) {
      this.#client = undefined;
      this.#status = {
        mode: this.mode,
        network: this.mode,
        state: "CONFIG_ERROR",
        message: configurationError
      };
      return;
    }

    const apiOrigin = options.config.apiOrigin as string;
    const apiToken = options.config.apiToken as string;
    this.#client =
      options.client ??
      new TxlineHttpClient({
        apiOrigin,
        apiToken,
        requestTimeoutMs: options.config.requestTimeoutMs,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn })
      });
    this.#status = {
      mode: this.mode,
      network: this.mode,
      state: "CONNECTING",
      message: "TxLINE is configured; no live request has been started."
    };
  }

  getStatus(): DataSourceStatus {
    return { ...this.#status };
  }

  getMatches(): readonly MatchDefinition[] {
    return this.#matches;
  }

  async hydrateSelectedFixture(
    fixtureId: string,
    competitionId?: string | number,
    signal?: AbortSignal
  ): Promise<MatchDefinition> {
    const client = this.requireClient();
    this.setStatus("CONNECTING", "Fetching TxLINE fixture snapshot.");
    const fixturePayload = await this.withRequestStatus(() =>
      client.fetchFixturesSnapshot(competitionId, signal)
    );
    const fixtures = normalizeFixtures(fixturePayload);
    this.#fixtures = new Map(
      fixtures.map((fixture) => [fixture.fixtureId, fixture])
    );
    const fixture = this.#fixtures.get(fixtureId);
    if (fixture === undefined) {
      this.setStatus(
        "SAFE_HOLD",
        "Selected fixture is unavailable, cancelled, or invalid."
      );
      throw new TxlineHttpError(
        "FIXTURE_NOT_AVAILABLE",
        "Selected TxLINE fixture is unavailable."
      );
    }
    if (fixture.selectionState === "AMBIGUOUS") {
      this.setStatus(
        "SAFE_HOLD",
        "Selected fixture is an ambiguous legacy duplicate."
      );
      throw new TxlineHttpError(
        "AMBIGUOUS_FIXTURE",
        "Selected TxLINE fixture is ambiguous."
      );
    }

    const [oddsPayload, scoresPayload] = await this.withRequestStatus(() =>
      Promise.all([
        client.fetchOddsSnapshot(fixture.fixtureId, signal),
        client.fetchScoresSnapshot(fixture.fixtureId, signal)
      ])
    );
    const normalizationOptions = {
      fixture,
      receivedTimestamp: this.#now()
    };
    const odds = normalizePayloads(
      oddsPayload,
      "odds",
      normalizationOptions
    );
    const scores = normalizePayloads(
      scoresPayload,
      "scores",
      normalizationOptions
    );
    for (const record of odds.records) {
      this.trackRecord("odds", record);
    }
    for (const record of scores.records) {
      this.trackRecord("scores", record);
    }

    const records = [...odds.records, ...scores.records].sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.sourceTimestamp - right.sourceTimestamp
    );
    const uncertain =
      odds.safeHold ||
      scores.safeHold ||
      odds.issues.length > 0 ||
      scores.issues.length > 0 ||
      records.length === 0;
    const expectedFirstSequence =
      records.length === 0
        ? undefined
        : Math.min(...records.map((record) => record.sequence));
    const match: MatchDefinition = {
      fixtureId: fixture.fixtureId,
      label: `${fixture.homeParticipant} vs ${fixture.awayParticipant} (TxLINE ${this.mode})`,
      provenance: "TXLINE",
      kickoffTimestamp: fixture.startTimestamp,
      liveEdgeTimestamp:
        records.length === 0
          ? Math.min(this.#now(), fixture.startTimestamp)
          : Math.max(...records.map((record) => record.sourceTimestamp)),
      ...(expectedFirstSequence === undefined
        ? {}
        : { expectedFirstSequence }),
      records
    };
    this.#matches = [match];
    this.setStatus(
      uncertain ? "SAFE_HOLD" : "SNAPSHOT_READY",
      uncertain
        ? "Snapshot contained uncertain ordering, timestamps, or unsupported records."
        : "TxLINE snapshots hydrated for the selected fixture."
    );
    return match;
  }

  async runStream(
    kind: TxlineStreamKind,
    options: RunStreamOptions
  ): Promise<void> {
    const client = this.requireClient();
    const maximumReconnects = options.maxReconnectAttempts ?? Infinity;
    let reconnectAttempt = 0;
    let retryHint: number | undefined;

    while (!isAborted(options.signal)) {
      let sawData = false;
      try {
        this.setStatus("CONNECTING", `Connecting to TxLINE ${kind} stream.`);
        const response = await client.openStream(kind, options.signal);
        if (response.body === null) {
          throw new TxlineHttpError(
            "EMPTY_STREAM",
            "TxLINE stream response had no body."
          );
        }

        for await (const frame of readSseFrames(
          response.body,
          options.signal
        )) {
          if (frame.kind === "heartbeat") {
            this.#status = {
              ...this.#status,
              state: sawData ? "LIVE" : "IDLE_NO_COVERAGE",
              lastHeartbeatAt: this.#now(),
              message: sawData
                ? "TxLINE stream is live."
                : "TxLINE stream is open with heartbeats and no covered data."
            };
            continue;
          }
          if (frame.retry !== undefined) {
            retryHint = Math.max(
              this.#config.reconnectBaseMs,
              Math.min(this.#config.reconnectMaxMs, frame.retry)
            );
          }
          if (frame.data === "") {
            continue;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            this.setStatus(
              "SAFE_HOLD",
              "TxLINE stream emitted an invalid JSON data message."
            );
            return;
          }

          const payloads = Array.isArray(payload) ? payload : [payload];
          for (const item of payloads) {
            const fixture = this.#fixtures.get(options.fixtureId);
            const recordOptions: NormalizeRecordOptions = {
              receivedTimestamp: this.#now(),
              ...(fixture === undefined ? {} : { fixture }),
              ...(frame.id === undefined ? {} : { eventId: frame.id })
            };
            const normalized =
              kind === "odds"
                ? normalizeOddsPayload(item, recordOptions)
                : normalizeScorePayload(item, recordOptions);
            if (normalized.disconnected) {
              throw new TxlineHttpError(
                "DISCONNECTED",
                "TxLINE reported a disconnected feed action."
              );
            }
            if (normalized.safeHold || normalized.issues.length > 0) {
              this.setStatus(
                "SAFE_HOLD",
                "TxLINE stream ordering or timestamp could not be trusted."
              );
              return;
            }
            for (const record of normalized.records) {
              if (record.fixtureId !== options.fixtureId) {
                continue;
              }
              const disposition = this.trackRecord(kind, record);
              if (disposition === "DUPLICATE") {
                continue;
              }
              if (disposition === "INVALID") {
                this.setStatus(
                  "SAFE_HOLD",
                  "TxLINE stream sequence or source timestamp regressed."
                );
                return;
              }
              sawData = true;
              this.appendRecord(record);
              await options.onRecord?.(record);
              this.#status = {
                ...this.#status,
                state: "LIVE",
                lastDataAt: this.#now(),
                message: "TxLINE stream is live."
              };
            }
          }
        }

        if (isAborted(options.signal)) {
          return;
        }
        if (!sawData) {
          this.setStatus(
            "IDLE_NO_COVERAGE",
            "TxLINE stream ended without covered data messages."
          );
        } else {
          this.setStatus("STALE", "TxLINE stream ended; reconnect is pending.");
        }
      } catch (error) {
        if (
          isAborted(options.signal) ||
          (error instanceof TxlineHttpError && error.code === "ABORTED")
        ) {
          return;
        }
        if (error instanceof TxlineConfigurationError) {
          this.setStatus("CONFIG_ERROR", error.message);
          return;
        }
        const sanitized = this.sanitize(error);
        this.setStatus(
          "STALE",
          sanitized === ""
            ? "TxLINE stream failed; reconnect is pending."
            : sanitized
        );
      }

      if (reconnectAttempt >= maximumReconnects) {
        return;
      }
      const delay =
        retryHint ??
        computeReconnectDelay(
          reconnectAttempt,
          this.#config.reconnectBaseMs,
          this.#config.reconnectMaxMs,
          this.#random
        );
      reconnectAttempt += 1;
      this.#status = {
        ...this.#status,
        reconnectAttempt,
        message: "TxLINE reconnect is scheduled."
      };
      await this.#sleep(delay, options.signal);
    }
  }

  private async withRequestStatus<T>(
    request: () => Promise<T>
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof TxlineConfigurationError) {
        this.setStatus("CONFIG_ERROR", this.sanitize(error));
        throw error;
      }
      if (error instanceof TxlineHttpError && error.code === "ABORTED") {
        throw error;
      }
      const message = this.sanitize(error);
      this.setStatus(
        "STALE",
        message === ""
          ? "TxLINE snapshot request failed."
          : message
      );
      throw error;
    }
  }

  private trackRecord(
    kind: TxlineStreamKind,
    record: MatchRecord
  ): "ACCEPT" | "DUPLICATE" | "INVALID" {
    const key = `${kind}:${record.fixtureId}`;
    const previous = this.#streamPositions.get(key);
    if (previous === undefined) {
      this.#streamPositions.set(key, {
        sequence: record.sequence,
        sourceTimestamp: record.sourceTimestamp,
        recordId: record.recordId
      });
      return "ACCEPT";
    }
    if (
      record.sequence === previous.sequence &&
      record.sourceTimestamp === previous.sourceTimestamp &&
      record.recordId === previous.recordId
    ) {
      return "DUPLICATE";
    }
    if (
      record.sequence <= previous.sequence ||
      record.sourceTimestamp < previous.sourceTimestamp
    ) {
      return "INVALID";
    }
    this.#streamPositions.set(key, {
      sequence: record.sequence,
      sourceTimestamp: record.sourceTimestamp,
      recordId: record.recordId
    });
    return "ACCEPT";
  }

  private sanitize(value: unknown): string {
    const apiToken = this.#config.apiToken;
    return sanitizedErrorMessage(
      value,
      apiToken === undefined ? [] : [apiToken]
    );
  }

  private requireClient(): TxlineClient {
    if (this.#client === undefined) {
      throw new TxlineConfigurationError(this.#status.message);
    }
    return this.#client;
  }

  private setStatus(
    state: DataSourceStatus["state"],
    message: string
  ): void {
    this.#status = {
      mode: this.mode,
      network: this.mode,
      state,
      message: this.sanitize(message)
    };
  }

  private appendRecord(record: MatchRecord): void {
    this.#matches = this.#matches.map((match) =>
      match.fixtureId === record.fixtureId
        ? {
            ...match,
            liveEdgeTimestamp: Math.max(
              match.liveEdgeTimestamp,
              record.sourceTimestamp
            ),
            records: [...match.records, record]
          }
        : match
    );
  }
}
