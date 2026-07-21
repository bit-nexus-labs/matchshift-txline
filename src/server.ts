import { pathToFileURL } from "node:url";
import Fastify, {
  type FastifyInstance,
  type FastifyReply
} from "fastify";
import { registerRoutes } from "./api/routes.js";
import type { MatchDefinition, ViewerSession } from "./core/types.js";
import { createMatchDataSource } from "./data-source/factory.js";
import type { MatchDataSource } from "./data-source/types.js";
import { PRODUCT_UPDATE_PAGE_HTML } from "./ui/product-update-page.js";

const PRODUCT_UPDATE_MARKDOWN_URL =
  "https://github.com/bit-nexus-labs/matchshift-txline/blob/main/docs/PRODUCT_UPDATE_2026-07-21.md";
const PRODUCT_UPDATE_PATH = "/product-update";
const PUBLIC_PAGE_CSP =
  "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export interface BuildAppOptions {
  matches?: readonly MatchDefinition[];
  dataSource?: MatchDataSource;
  env?: Readonly<Record<string, string | undefined>>;
}

function publicHtmlReply(reply: FastifyReply): FastifyReply {
  return reply
    .header("Content-Security-Policy", PUBLIC_PAGE_CSP)
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "no-referrer")
    .header("Cache-Control", "no-store")
    .type("text/html; charset=utf-8");
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const dataSource =
    options.dataSource ??
    createMatchDataSource(options.env ?? process.env);
  const matches = new Map(
    (options.matches ?? dataSource.getMatches()).map((match) => [
      match.fixtureId,
      match
    ])
  );
  const sessions = new Map<string, ViewerSession>();

  app.addHook("onSend", async (request, _reply, payload) => {
    if (
      request.method === "GET" &&
      request.url === "/" &&
      typeof payload === "string"
    ) {
      return payload.replace(PRODUCT_UPDATE_MARKDOWN_URL, PRODUCT_UPDATE_PATH);
    }
    return payload;
  });

  app.get(PRODUCT_UPDATE_PATH, async (_request, reply) => {
    await publicHtmlReply(reply).send(PRODUCT_UPDATE_PAGE_HTML);
  });

  void registerRoutes(app, { matches, sessions, dataSource });
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
