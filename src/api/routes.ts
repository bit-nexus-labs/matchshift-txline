import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { deriveVisibleMatchState } from "../core/derive-state.js";
import {
  createViewerSession,
  transitionSession
} from "../core/session-machine.js";
import type { MatchDefinition, ViewerSession } from "../core/types.js";
import { createSessionSchema, sessionCommandSchema } from "./schemas.js";

interface RouteOptions {
  matches: ReadonlyMap<string, MatchDefinition>;
  sessions: Map<string, ViewerSession>;
}

function invalidRequest(reply: FastifyReply, issues: unknown): void {
  void reply.status(400).send({
    error: "INVALID_REQUEST",
    issues
  });
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions
): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      invalidRequest(reply, parsed.error.issues);
      return;
    }

    const match = options.matches.get(parsed.data.fixtureId);
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
      ...(parsed.data.delayMs === undefined ? {} : { delayMs: parsed.data.delayMs })
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

      const match = options.matches.get(session.fixtureId);
      if (match === undefined) {
        await reply.status(404).send({ error: "FIXTURE_NOT_FOUND" });
        return;
      }

      return deriveVisibleMatchState(match, session);
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

      const match = options.matches.get(session.fixtureId);
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
