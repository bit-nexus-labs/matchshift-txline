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
import { CURATED_REAL_MATCH } from "../replay/curated-real-match.js";
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

function replaceRequired(
  source: string,
  search: string,
  replacement: string
): string {
  if (!source.includes(search)) {
    throw new Error("The judge page patch target was not found.");
  }
  return source.replace(search, replacement);
}

function buildJudgeDemoPage(): string {
  let page = DEMO_PAGE_HTML;
  page = replaceRequired(
    page,
    "one at the live edge and one six minutes behind",
    "one at the live edge and one at an earlier personal cursor"
  );
  page = replaceRequired(
    page,
    '        el[prefix + "-minute"].textContent = "Viewer minute " + state.session.viewerMinute;',
    viewerTimeScript
  );
  page = replaceRequired(
    page,
    '<button class="primary" id="start-demo">Start spoiler-safe demo</button>',
    [
      '<button class="primary" id="start-demo">Start synthetic judge demo</button>',
      '<button class="secondary" id="start-curated" style="display:none;width:100%;margin-top:10px">Start curated real-match replay</button>'
    ].join("\n        ")
  );
  page = replaceRequired(
    page,
    '        busy: false\n      };',
    '        busy: false,\n        demoEndpoint: "/api/demo/start"\n      };'
  );
  page = replaceRequired(
    page,
    '        "start-demo", "cursor", "advance-one", "pause", "resume", "catch-up",',
    '        "start-demo", "start-curated", "cursor", "advance-one", "pause", "resume", "catch-up",'
  );
  page = replaceRequired(
    page,
    '[el["start-demo"], el.cursor, el["advance-one"], el.pause, el.resume, el["catch-up"]]',
    '[el["start-demo"], el["start-curated"], el.cursor, el["advance-one"], el.pause, el.resume, el["catch-up"]]'
  );
  page = replaceRequired(
    page,
    '          var copy = event.eventType === "GOAL"\n            ? (event.team === "HOME" ? "Northbridge goal" : "Southport goal")\n            : "Kickoff";',
    '          var copy = event.eventType === "GOAL"\n            ? (event.team === "HOME" ? model.fixture.homeLabel + " goal" : model.fixture.awayLabel + " goal")\n            : "Kickoff";'
  );
  page = replaceRequired(
    page,
    '        badge.textContent = state.safety.active ? "SAFE HOLD" : state.session.statusBadge;',
    '        badge.textContent = state.safety.active\n          ? "SAFE HOLD"\n          : (prefix === "live" && model.fixture && model.fixture.demoKind === "CURATED"\n            ? "FINAL STATE"\n            : state.session.statusBadge);'
  );
  page = replaceRequired(
    page,
    '        if (model.fixture) {\n          el["match-title"].textContent = "Northbridge vs Southport";\n          el["match-meta"].textContent = model.fixture.provenance + " replay · two independent server sessions";\n        }',
    [
      '        if (model.fixture) {',
      '          el["match-title"].textContent = model.fixture.homeLabel + " vs " + model.fixture.awayLabel;',
      '          el["match-meta"].textContent = model.fixture.demoKind === "CURATED"',
      '            ? "Authenticated TxLINE completed-match replay · two isolated server sessions"',
      '            : model.fixture.provenance + " replay · two independent server sessions";',
      '          var teams = document.querySelectorAll(".team");',
      '          if (teams.length >= 4) {',
      '            teams[0].textContent = model.fixture.homeLabel;',
      '            teams[1].textContent = model.fixture.awayLabel;',
      '            teams[2].textContent = model.fixture.homeLabel;',
      '            teams[3].textContent = model.fixture.awayLabel;',
      '          }',
      '          var headings = document.querySelectorAll(".viewer-heading h2");',
      '          if (headings.length >= 2) {',
      '            headings[0].textContent = model.fixture.demoKind === "CURATED" ? "Completed edge" : "Live edge";',
      '            headings[1].textContent = model.fixture.demoKind === "CURATED" ? "Replay from kickoff" : "Personal timeline";',
      '          }',
      '        }'
    ].join("\n")
  );
  page = replaceRequired(
    page,
    '      function startDemo() {',
    '      function startDemo(endpoint) {'
  );
  page = replaceRequired(
    page,
    '        api("/api/demo/start", { method: "POST", body: "{}" })',
    '        api(endpoint, { method: "POST", body: "{}" })'
  );
  page = replaceRequired(
    page,
    '            model.fixture = payload.fixture;',
    '            model.demoEndpoint = endpoint;\n            model.fixture = payload.fixture;'
  );
  page = replaceRequired(
    page,
    '      el["start-demo"].addEventListener("click", startDemo);',
    '      el["start-demo"].addEventListener("click", function () { startDemo("/api/demo/start"); });\n      el["start-curated"].addEventListener("click", function () { startDemo("/api/demo/curated/start"); });'
  );
  page = replaceRequired(
    page,
    '      el.reset.addEventListener("click", startDemo);',
    '      el.reset.addEventListener("click", function () { startDemo(model.demoEndpoint); });'
  );
  page = replaceRequired(
    page,
    '        .catch(function () {\n          el["source-status"].textContent = "Judge replay ready";\n        });\n    })();',
    [
      '        .catch(function () {',
      '          el["source-status"].textContent = "Judge replay ready";',
      '        });',
      '      api("/api/demo/curated/status")',
      '        .then(function (status) {',
      '          if (!status.available) return;',
      '          el["start-curated"].style.display = "block";',
      '          el["source-status"].textContent = "Synthetic judge demo + curated TxLINE replay ready";',
      '        })',
      '        .catch(function () {',
      '          el["start-curated"].style.display = "none";',
      '        });',
      '    })();'
    ].join("\n")
  );
  return page;
}

const JUDGE_DEMO_PAGE_HTML = buildJudgeDemoPage();

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

function matchDisplay(match: MatchDefinition): {
  homeLabel: string;
  awayLabel: string;
} {
  if (match.display !== undefined) {
    return match.display;
  }
  const primaryLabel = match.label.split(" - ", 1)[0] ?? match.label;
  const parts = primaryLabel.split(/\s+vs\.?\s+/i);
  return {
    homeLabel: parts[0]?.trim() || "Home",
    awayLabel: parts[1]?.trim() || "Away"
  };
}

function publicFixture(match: MatchDefinition) {
  const display = matchDisplay(match);
  return {
    fixtureId: match.fixtureId,
    label: match.label,
    provenance: match.provenance,
    homeLabel: display.homeLabel,
    awayLabel: display.awayLabel,
    demoKind: match === CURATED_REAL_MATCH ? "CURATED" : "SYNTHETIC"
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

function demoFixturePayload(match: MatchDefinition) {
  return {
    ...publicFixture(match),
    kickoffTimestamp: match.kickoffTimestamp,
    liveEdgeTimestamp: match.liveEdgeTimestamp,
    maxMinute: Math.floor(
      (match.liveEdgeTimestamp - match.kickoffTimestamp) / 60_000
    )
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions
): Promise<void> {
  const findMatch = (fixtureId: string): MatchDefinition | undefined =>
    fixtureId === SYNTHETIC_FIXTURE_ID
      ? SYNTHETIC_MATCH
      : CURATED_REAL_MATCH?.fixtureId === fixtureId
        ? CURATED_REAL_MATCH
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
    if (CURATED_REAL_MATCH !== undefined) {
      fixtures.set(CURATED_REAL_MATCH.fixtureId, CURATED_REAL_MATCH);
    }
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

  app.get("/api/demo/curated/status", async () =>
    CURATED_REAL_MATCH === undefined
      ? { available: false }
      : {
          available: true,
          fixture: publicFixture(CURATED_REAL_MATCH),
          note: "Single curated completed-match replay; not a provider feed or archive."
        }
  );

  app.post("/api/demo/start", async (_request, reply) => {
    const match = SYNTHETIC_MATCH;
    const delayedCursor = match.kickoffTimestamp + 43 * 60_000;
    const live = createSessionPayload(match, "LIVE");
    const personal = createSessionPayload(match, "DELAYED", delayedCursor);
    options.sessions.set(live.session.sessionId, live.session);
    options.sessions.set(personal.session.sessionId, personal.session);

    await reply.status(201).send({
      fixture: demoFixturePayload(match),
      live,
      personal
    });
  });

  app.post("/api/demo/curated/start", async (_request, reply) => {
    const match = CURATED_REAL_MATCH;
    if (match === undefined) {
      await reply.status(404).send({ error: "CURATED_REPLAY_NOT_AVAILABLE" });
      return;
    }
    const completed = createSessionPayload(match, "LIVE");
    const replay = createSessionPayload(match, "REPLAY", match.kickoffTimestamp);
    options.sessions.set(completed.session.sessionId, completed.session);
    options.sessions.set(replay.session.sessionId, replay.session);

    await reply.status(201).send({
      fixture: demoFixturePayload(match),
      live: completed,
      personal: replay
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
