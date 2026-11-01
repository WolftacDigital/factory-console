// Match the complete authority, not a prefix, suffix, or DNS-resolved address.
export function isAllowedHost(host: string | null, port: number): boolean {
  if (host === null) return false;
  const authority = host.toLowerCase();
  return authority === `127.0.0.1:${port}` || authority === `localhost:${port}`;
}
