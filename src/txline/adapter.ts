import type { MatchDefinition, MatchRecord } from "../core/types.js";
import { compareMatchRecords } from "../core/visibility.js";
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
  type NormalizeRecordOptions,
  type NormalizationResult
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
  openStream(kind: TxlineStreamKind, signal?: AbortSignal): Promise<Response>;
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

interface StreamPosition {
  latestScoreSequence?: number;
  latestScoreTimestamp?: number;
  identities: Set<string>;
}

type TrackDisposition =
  | "ACCEPT"
  | "DUPLICATE"
  | "INVALID"
  | "GAP"
  | "NEEDS_BASELINE";

class SnapshotRecoveryRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotRecoveryRequiredError";
  }
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

function recordIdentity(record: MatchRecord): string {
  const sourceOrder = record.sourceOrder;
  return sourceOrder === undefined
    ? [
        "SYNTHETIC",
        record.fixtureId,
        record.recordId,
        record.sequence ?? "",
        record.sourceTimestamp,
        record.kind
      ].join("|")
    : [
        sourceOrder.domain,
        record.fixtureId,
        sourceOrder.sourceMessageId ?? record.recordId,
        sourceOrder.sseEventId ?? "",
        record.sourceTimestamp,
        sourceOrder.payloadIdentity,
        record.kind
      ].join("|");
}

function mergeRecords(
  existing: readonly MatchRecord[],
  incoming: readonly MatchRecord[]
): MatchRecord[] {
  const merged = new Map<string, MatchRecord>();
  for (const record of [...existing, ...incoming]) {
    merged.set(recordIdentity(record), record);
  }
  return [...merged.values()].sort(compareMatchRecords);
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
  #streamPositions = new Map<string, StreamPosition>();
  #selected:
    | { fixtureId: string; competitionId?: string | number }
    | undefined;

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
    return this.hydrateFixture(fixtureId, competitionId, signal, false);
  }

  async runStream(
    kind: TxlineStreamKind,
    options: RunStreamOptions
  ): Promise<void> {
    const client = this.requireClient();
    if (this.#selected?.fixtureId !== options.fixtureId) {
      this.setStatus(
        "SAFE_HOLD",
        "TxLINE snapshot hydration is required before SSE streaming."
      );
      return;
    }

    const maximumReconnects = options.maxReconnectAttempts ?? Infinity;
    let reconnectAttempt = 0;
    let retryHint: number | undefined;
    let needsHydration = false;

    while (!isAborted(options.signal)) {
      let sawData = false;
      try {
        if (needsHydration) {
          const selected = this.#selected;
          if (selected === undefined || selected.fixtureId !== options.fixtureId) {
            this.setStatus(
              "SAFE_HOLD",
              "TxLINE stream recovery has no selected fixture baseline."
            );
            return;
          }
          await this.hydrateFixture(
            selected.fixtureId,
            selected.competitionId,
            options.signal,
            true
          );
          needsHydration = false;
          if (this.#status.state === "SAFE_HOLD") {
            return;
          }
        }

        this.setStatus("CONNECTING", `Connecting to TxLINE ${kind} stream.`);
        const response = await client.openStream(kind, options.signal);
        if (response.body === null) {
          throw new TxlineHttpError(
            "EMPTY_STREAM",
            "TxLINE stream response had no body."
          );
        }

        for await (const frame of readSseFrames(response.body, options.signal)) {
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
              needsHydration = true;
              throw new SnapshotRecoveryRequiredError(
                "TxLINE reported a disconnected feed action."
              );
            }
            if (normalized.safeHold || normalized.issues.length > 0) {
              this.setStatus(
                "SAFE_HOLD",
                kind === "scores"
                  ? "Relevant TxLINE score fields could not be trusted."
                  : "Claimed TxLINE match-winner fields could not be trusted."
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
                  "TxLINE source ordering regressed or was internally inconsistent."
                );
                return;
              }
              if (disposition === "GAP" || disposition === "NEEDS_BASELINE") {
                needsHydration = true;
                throw new SnapshotRecoveryRequiredError(
                  disposition === "GAP"
                    ? "TxLINE score sequence gap detected; snapshot recovery is required."
                    : "TxLINE score stream has no trusted snapshot baseline."
                );
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
        needsHydration = true;
        this.setStatus(
          sawData ? "STALE" : "IDLE_NO_COVERAGE",
          sawData
            ? "TxLINE stream ended; reconnect and snapshot recovery are pending."
            : "TxLINE stream ended without covered data messages."
        );
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
        if (error instanceof SnapshotRecoveryRequiredError) {
          this.setStatus("SAFE_HOLD", error.message);
        } else {
          const sanitized = this.sanitize(error);
          this.setStatus(
            "STALE",
            sanitized === ""
              ? "TxLINE stream failed; reconnect is pending."
              : sanitized
          );
          needsHydration = true;
        }
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

  private async hydrateFixture(
    fixtureId: string,
    competitionId: string | number | undefined,
    signal: AbortSignal | undefined,
    preserveHistory: boolean
  ): Promise<MatchDefinition> {
    const client = this.requireClient();
    const previous = this.#matches.find((match) => match.fixtureId === fixtureId);
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
    const odds = normalizePayloads(oddsPayload, "odds", normalizationOptions);
    const scores = normalizePayloads(
      scoresPayload,
      "scores",
      normalizationOptions
    );
    const uncertain = this.isUncertain(odds) || this.isUncertain(scores);
    if (uncertain) {
      if (preserveHistory && previous !== undefined) {
        this.#matches = [previous];
      }
      this.setStatus(
        "SAFE_HOLD",
        "A claimed supported TxLINE snapshot payload could not be trusted."
      );
      return previous ?? this.emptyMatch(fixture);
    }

    this.clearFixturePositions(fixture.fixtureId);
    for (const record of odds.records) {
      this.trackRecord("odds", record, true);
    }
    for (const record of scores.records) {
      this.trackRecord("scores", record, true);
    }

    const snapshotRecords = [...odds.records, ...scores.records].sort(
      compareMatchRecords
    );
    const records =
      preserveHistory && previous !== undefined
        ? mergeRecords(previous.records, snapshotRecords)
        : snapshotRecords;
    const match: MatchDefinition = {
      fixtureId: fixture.fixtureId,
      label: `${fixture.homeParticipant} vs ${fixture.awayParticipant} (TxLINE ${this.mode})`,
      provenance: "TXLINE",
      kickoffTimestamp: fixture.startTimestamp,
      liveEdgeTimestamp:
        records.length === 0
          ? Math.min(this.#now(), fixture.startTimestamp)
          : Math.max(...records.map((record) => record.sourceTimestamp)),
      records
    };
    this.#matches = [match];
    this.#selected =
      competitionId === undefined
        ? { fixtureId: fixture.fixtureId }
        : { fixtureId: fixture.fixtureId, competitionId };

    this.setStatus(
      records.length === 0 ? "IDLE_NO_COVERAGE" : "SNAPSHOT_READY",
      records.length === 0
        ? "TxLINE snapshots contained no supported score or match-winner data."
        : "Independent TxLINE score and odds snapshots are ready."
    );
    return match;
  }

  private emptyMatch(fixture: NormalizedFixture): MatchDefinition {
    return {
      fixtureId: fixture.fixtureId,
      label: `${fixture.homeParticipant} vs ${fixture.awayParticipant} (TxLINE ${this.mode})`,
      provenance: "TXLINE",
      kickoffTimestamp: fixture.startTimestamp,
      liveEdgeTimestamp: Math.min(this.#now(), fixture.startTimestamp),
      records: []
    };
  }

  private isUncertain(result: NormalizationResult): boolean {
    return result.safeHold || result.issues.length > 0;
  }

  private async withRequestStatus<T>(request: () => Promise<T>): Promise<T> {
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
        message === "" ? "TxLINE snapshot request failed." : message
      );
      throw error;
    }
  }

  private trackRecord(
    kind: TxlineStreamKind,
    record: MatchRecord,
    snapshot = false
  ): TrackDisposition {
    const sourceOrder = record.sourceOrder;
    const expectedDomain =
      kind === "scores" ? "TXLINE_SCORES" : "TXLINE_ODDS";
    if (sourceOrder === undefined || sourceOrder.domain !== expectedDomain) {
      return "INVALID";
    }

    const key = `${kind}:${record.fixtureId}`;
    const identity = recordIdentity(record);
    const previous = this.#streamPositions.get(key);
    if (previous?.identities.has(identity) === true) {
      return "DUPLICATE";
    }

    if (kind === "odds") {
      if (previous === undefined) {
        this.#streamPositions.set(key, {
          identities: new Set([identity])
        });
      } else {
        previous.identities.add(identity);
      }
      return "ACCEPT";
    }

    const sourceSequence = sourceOrder.sourceSequence;
    if (sourceSequence === undefined) {
      return "INVALID";
    }
    if (previous === undefined) {
      if (!snapshot) {
        return "NEEDS_BASELINE";
      }
      this.#streamPositions.set(key, {
        latestScoreSequence: sourceSequence,
        latestScoreTimestamp: record.sourceTimestamp,
        identities: new Set([identity])
      });
      return "ACCEPT";
    }

    const previousSequence = previous.latestScoreSequence;
    const previousTimestamp = previous.latestScoreTimestamp;
    if (previousSequence === undefined || previousTimestamp === undefined) {
      return "INVALID";
    }
    if (
      sourceSequence <= previousSequence ||
      record.sourceTimestamp < previousTimestamp
    ) {
      return "INVALID";
    }
    if (!snapshot && sourceSequence > previousSequence + 1) {
      return "GAP";
    }

    previous.latestScoreSequence = sourceSequence;
    previous.latestScoreTimestamp = record.sourceTimestamp;
    previous.identities.add(identity);
    return "ACCEPT";
  }

  private clearFixturePositions(fixtureId: string): void {
    for (const key of [...this.#streamPositions.keys()]) {
      if (key.endsWith(`:${fixtureId}`)) {
        this.#streamPositions.delete(key);
      }
    }
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
            records: mergeRecords(match.records, [record])
          }
        : match
    );
  }
}
