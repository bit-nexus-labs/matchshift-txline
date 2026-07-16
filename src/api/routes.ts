import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { deriveVisibleMatchState } from "../core/derive-state.js";
import {
  createViewerSession,
  transitionSession
} from "../core/session-machine.js";
import type {
  MatchDefinition,
  SessionMode,
  ViewerSession
} from "../core/types.js";
import { createVisibilityReceipt } from "../core/visibility-receipt.js";
import type { MatchDataSource } from "../data-source/types.js";
import {
  SYNTHETIC_FIXTURE_ID,
  SYNTHETIC_MATCH
} from "../replay/synthetic-scenario.js";
import { DEMO_PAGE_HTML } from "../ui/demo-page.js";
import { createSessionSchema, sessionCommandSchema } from "./schemas.js";

const viewerTimeScript = [
  "        var viewerTime = model.fixture",
  "          ? minuteLabel((session.visibilityCursor - model.fixture.kickoffTimestamp) / 60000)",
  "          : String(state.session.viewerMinute).padStart(2, \"0\") + \":00\";",
  "        el[prefix + \"-minute\"].textContent = \"Viewer time \" + viewerTime;"
].join("\n");

const JUDGE_DEMO_PAGE_HTML = DEMO_PAGE_HTML
  .replace(
    "one at the live edge and one six minutes behind",
    "one at the live edge and one at an earlier personal cursor"
  )
  .replace(
    '        el[prefix + "-minute"].textContent = "Viewer minute " + state.session.viewerMinute;',
    viewerTimeScript
  );

interface RouteOptions {
  matches: ReadonlyMap<string, MatchDefinition>;
  sessions: Map<string, ViewerSession>;
  dataSource: MatchDataSource;
}

function invalidRequest(reply: FastifyReply, issues: unknown): void {
  void reply.status(400).send({
    error: "INVALID_REQUEST",
    issues
  });
}

function publicFixture(match: MatchDefinition) {
  return {
    fixtureId: match.fixtureId,
    label: match.label,
    provenance: match.provenance
  };
}

function createSessionPayload(
  match: MatchDefinition,
  mode: SessionMode,
  visibilityCursor?: number
) {
  const session = createViewerSession({
    sessionId: randomUUID(),
    fixtureId: match.fixtureId,
    mode,
    liveEdgeTimestamp: match.liveEdgeTimestamp,
    ...(visibilityCursor === undefined ? {} : { visibilityCursor })
  });
  return {
    session,
    state: deriveVisibleMatchState(match, session)
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions
): Promise<void> {
  const findMatch = (fixtureId: string): MatchDefinition | undefined =>
    fixtureId === SYNTHETIC_FIXTURE_ID
      ? SYNTHETIC_MATCH
      : options.matches.get(fixtureId) ??
        options.dataSource
          .getMatches()
          .find((match) => match.fixtureId === fixtureId);

  app.get("/", async (_request, reply) => {
    await reply
      .header(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      )
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store")
      .type("text/html; charset=utf-8")
      .send(JUDGE_DEMO_PAGE_HTML);
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/data-source/status", async () => options.dataSource.getStatus());

  app.get("/api/fixtures", async () => {
    const fixtures = new Map<string, MatchDefinition>();
    fixtures.set(SYNTHETIC_MATCH.fixtureId, SYNTHETIC_MATCH);
    for (const match of options.matches.values()) {
      fixtures.set(match.fixtureId, match);
    }
    for (const match of options.dataSource.getMatches()) {
      fixtures.set(match.fixtureId, match);
    }
    return {
      fixtures: [...fixtures.values()].map(publicFixture)
    };
  });

  app.post("/api/demo/start", async (_request, reply) => {
    const match = SYNTHETIC_MATCH;
    const delayedCursor = match.kickoffTimestamp + 43 * 60_000;
    const live = createSessionPayload(match, "LIVE");
    const personal = createSessionPayload(match, "DELAYED", delayedCursor);
    options.sessions.set(live.session.sessionId, live.session);
    options.sessions.set(personal.session.sessionId, personal.session);

    await reply.status(201).send({
      fixture: {
        ...publicFixture(match),
        kickoffTimestamp: match.kickoffTimestamp,
        liveEdgeTimestamp: match.liveEdgeTimestamp,
        maxMinute: Math.floor(
          (match.liveEdgeTimestamp - match.kickoffTimestamp) / 60_000
        )
      },
      live,
      personal
    });
  });

  app.post("/api/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      invalidRequest(reply, parsed.error.issues);
      return;
    }

    const match = findMatch(parsed.data.fixtureId);
    if (match === undefined) {
      await reply.status(404).send({ error: "FIXTURE_NOT_FOUND" });
      return;
    }

    const session = createViewerSession({
      sessionId: randomUUID(),
      fixtureId: match.fixtureId,
      mode: parsed.data.mode,
      liveEdgeTimestamp: match.liveEdgeTimestamp,
      ...(parsed.data.visibilityCursor === undefined
        ? {}
        : { visibilityCursor: parsed.data.visibilityCursor }),
      ...(parsed.data.delayMs === undefined
        ? {}
        : { delayMs: parsed.data.delayMs })
    });
    options.sessions.set(session.sessionId, session);

    await reply.status(201).send({
      session,
      state: deriveVisibleMatchState(match, session)
    });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/state",
    async (request, reply) => {
      const session = options.sessions.get(request.params.sessionId);
      if (session === undefined) {
        await reply.status(404).send({ error: "SESSION_NOT_FOUND" });
        return;
      }

      const match = findMatch(session.fixtureId);
      if (match === undefined) {
        await reply.status(404).send({ error: "FIXTURE_NOT_FOUND" });
        return;
      }

      return deriveVisibleMatchState(match, session);
    }
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/receipt",
    async (request, reply) => {
      const session = options.sessions.get(request.params.sessionId);
      if (session === undefined) {
        await reply.status(404).send({ error: "SESSION_NOT_FOUND" });
        return;
      }

      const match = findMatch(session.fixtureId);
      if (match === undefined) {
        await reply.status(404).send({ error: "FIXTURE_NOT_FOUND" });
        return;
      }

      const state = deriveVisibleMatchState(match, session);
      await reply.header("Cache-Control", "no-store").send({
        receipt: createVisibilityReceipt(state),
        note: "Deterministic state receipt; not a provider signature or on-chain proof."
      });
    }
  );

  app.patch<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId",
    async (request, reply) => {
      const session = options.sessions.get(request.params.sessionId);
      if (session === undefined) {
        await reply.status(404).send({ error: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = sessionCommandSchema.safeParse(request.body);
      if (!parsed.success) {
        invalidRequest(reply, parsed.error.issues);
        return;
      }

      const match = findMatch(session.fixtureId);
      if (match === undefined) {
        await reply.status(404).send({ error: "FIXTURE_NOT_FOUND" });
        return;
      }

      const updated = transitionSession(
        session,
        parsed.data,
        match.liveEdgeTimestamp
      );
      options.sessions.set(updated.sessionId, updated);

      return {
        session: updated,
        state: deriveVisibleMatchState(match, updated)
      };
    }
  );
}
