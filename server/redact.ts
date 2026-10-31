// Regex redaction applied to every free-text field before it leaves the server.
export const REDACTION_PATTERNS: RegExp[] = [
  /lin_api_\w+/g,
  /lin_oauth_\w+/g,
  /xox[abposr]-[\w-]+/g,
  /sk-ant-[\w-]+/g,
  /sk-[\w-]{10,}/g,
  /gh[pousr]_\w+/g,
  /Bearer\s+\S+/g,
  /(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi,
];

export const REDACTED = "[REDACTED]";

export function redact(input: unknown): string {
  if (input === null || input === undefined) return "";
  let text = typeof input === "string" ? input : JSON.stringify(input);
  for (const re of REDACTION_PATTERNS) {
    re.lastIndex = 0;
    text = text.replace(re, REDACTED);
  }
  return text;
}

export function redactOrNull(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  return redact(input);
}
