import {
  observeLiveSnapshotChanges,
  writeLiveSnapshotObserverReceipt
} from "./live-snapshot-observer.js";
import { sanitizedErrorMessage } from "./redaction.js";

async function main(
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const apiToken = env.TXLINE_API_TOKEN?.trim() ?? "";
  try {
    const result = await observeLiveSnapshotChanges(env);
    const receiptPath =
      env.TXLINE_LIVE_SNAPSHOT_RECEIPT_PATH?.trim() ||
      "artifacts/private/txline-live-snapshot-observer.md";
    await writeLiveSnapshotObserverReceipt(result, receiptPath);
    if (result.status === "PASS") {
      process.stdout.write("TXLINE LIVE SNAPSHOT CHANGE OBSERVER: PASS\n");
      process.stdout.write(`Observed domain: ${result.observedKind ?? "unknown"}\n`);
      process.stdout.write(`Receipt written: ${receiptPath}\n`);
      return;
    }
    process.stdout.write("TXLINE LIVE SNAPSHOT CHANGE OBSERVER: NOT OBSERVED\n");
    process.stdout.write(
      "No normalized score or odds snapshot change arrived before the observation window ended.\n"
    );
    process.stdout.write(`Receipt written: ${receiptPath}\n`);
    process.exitCode = 2;
  } catch (error) {
    const message = sanitizedErrorMessage(error, [apiToken]);
    process.stderr.write(
      `TXLINE LIVE SNAPSHOT CHANGE OBSERVER: FAIL (${message})\n`
    );
    process.exitCode = 1;
  }
}

await main();
