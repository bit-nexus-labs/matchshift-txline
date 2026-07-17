export const TXLINE_MAINNET_PROGRAM_ID =
  "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA";
export const TXLINE_MAINNET_TOKEN_MINT =
  "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL";
export const TXLINE_MAINNET_API_ORIGIN = "https://txline.txodds.com";
export const TXLINE_MAINNET_RPC_ORIGIN =
  "https://api.mainnet-beta.solana.com";
export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const TXLINE_FREE_REALTIME_SERVICE_LEVEL_ID = 12;
export const TXLINE_DEFAULT_DURATION_WEEKS = 4;

export const SUBSCRIBE_DISCRIMINATOR = Uint8Array.from([
  254, 28, 191, 138, 156, 179, 183, 53
]);

export function encodeSubscribeInstruction(
  serviceLevelId: number,
  durationWeeks: number
): Uint8Array {
  if (
    !Number.isSafeInteger(serviceLevelId) ||
    serviceLevelId < 0 ||
    serviceLevelId > 0xffff
  ) {
    throw new Error("serviceLevelId must be a u16 integer.");
  }
  if (
    !Number.isSafeInteger(durationWeeks) ||
    durationWeeks <= 0 ||
    durationWeeks > 0xff
  ) {
    throw new Error("durationWeeks must be a positive u8 integer.");
  }

  const data = new Uint8Array(SUBSCRIBE_DISCRIMINATOR.length + 3);
  data.set(SUBSCRIBE_DISCRIMINATOR, 0);
  data[8] = serviceLevelId & 0xff;
  data[9] = (serviceLevelId >> 8) & 0xff;
  data[10] = durationWeeks;
  return data;
}

export function createActivationMessage(
  transactionSignature: string,
  guestJwt: string
): string {
  const txSig = transactionSignature.trim();
  const jwt = guestJwt.trim();
  if (txSig === "" || jwt === "") {
    throw new Error("Transaction signature and guest JWT are required.");
  }
  return `${txSig}::${jwt}`;
}
