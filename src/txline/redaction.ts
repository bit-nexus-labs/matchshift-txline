function replaceLiteral(value: string, secret: string): string {
  return secret === "" ? value : value.split(secret).join("[REDACTED]");
}

export function redactSensitiveText(
  value: string,
  secrets: readonly string[] = []
): string {
  let redacted = value;
  for (const secret of secrets) {
    redacted = replaceLiteral(redacted, secret);
  }

  return redacted
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(X-Api-Token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED_JWT]"
    );
}

export function sanitizedErrorMessage(
  error: unknown,
  secrets: readonly string[] = []
): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message, secrets);
}
