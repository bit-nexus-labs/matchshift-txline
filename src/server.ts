import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "./api/routes.js";
import type { MatchDefinition, ViewerSession } from "./core/types.js";
import { SYNTHETIC_MATCH } from "./replay/synthetic-scenario.js";

export interface BuildAppOptions {
  matches?: readonly MatchDefinition[];
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const matches = new Map(
    (options.matches ?? [SYNTHETIC_MATCH]).map((match) => [
      match.fixtureId,
      match
    ])
  );
  const sessions = new Map<string, ViewerSession>();

  void registerRoutes(app, { matches, sessions });
  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
