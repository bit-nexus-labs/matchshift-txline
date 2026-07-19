import {
  writeLiveObserverReceipt
} from "./live-observer.js";
import { observeLiveInputForWindow } from "./live-observer-window.js";
import { sanitizedErrorMessage } from "./redaction.js";

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await observeLiveInputForWindow(env);
    const receiptPath =
      env.TXLINE_LIVE_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-live-observer.md";
    await writeLiveObserverReceipt(result, receiptPath);
    if (result.status === "PASS") {
      process.stdout.write("TXLINE LIVE INPUT OBSERVER: PASS\n");
      process.stdout.write(`Receipt written: ${receiptPath}\n`);
      return;
    }
    process.stdout.write("TXLINE LIVE INPUT OBSERVER: NOT OBSERVED\n");
    process.stdout.write(
      "No normalized SSE data record arrived before the full observation window ended.\n"
    );
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
    process.exitCode = 2;
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(`TXLINE LIVE INPUT OBSERVER: FAIL (${message})\n`);
    process.exitCode = 1;
  }
}

await main();
