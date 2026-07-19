import {
  observeLiveOddsTransport,
  writeLiveOddsTransportReceipt
} from "./live-odds-transport-observer.js";
import { sanitizedErrorMessage } from "./redaction.js";

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await observeLiveOddsTransport(env);
    const receiptPath =
      env.TXLINE_LIVE_TRANSPORT_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-live-odds-transport-observer.md";
    await writeLiveOddsTransportReceipt(result, receiptPath);

    if (result.status === "PASS") {
      process.stdout.write("TXLINE LIVE ODDS TRANSPORT OBSERVER: PASS\n");
      process.stdout.write("Structurally valid non-heartbeat odds event received: PASS\n");
      process.stdout.write(`Receipt written: ${receiptPath}\n`);
      return;
    }

    process.stdout.write("TXLINE LIVE ODDS TRANSPORT OBSERVER: NOT OBSERVED\n");
    process.stdout.write(
      "No structurally valid non-heartbeat odds event arrived before the observation window ended.\n"
    );
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
    process.exitCode = 2;
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(
      `TXLINE LIVE ODDS TRANSPORT OBSERVER: FAIL (${message})\n`
    );
    process.exitCode = 1;
  }
}

await main();
