// An HTTP response as the server part reports it: status, headers in
// order, body, sizes, timings, redirects, the connection; and reading its
// status class and its cookies.

export interface Timings {
  /** Each phase, in ms (null when it didn't happen: no lookup for an IP
   * address, no TLS for http). */
  dns: number | null;
  connect: number | null;
  tls: number | null;
  /** From the request sent to the answer's first byte. */
  firstByte: number | null;
  download: number | null;
  total: number;
}

export interface Hop {
  url: string;
  status: number;
  statusText: string;
  location: string;
}

export interface TlsInfo {
  protocol: string | null;
  cipher: string | null;
  authorized: boolean;
  error: string | null;
  subject: string | null;
  issuer: string | null;
  validTo: string | null;
}

export interface Response {
  /** For saving its body (`body`, while the server part keeps it). */
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  httpVersion: string;
  /** In the order they came, duplicates kept. */
  headers: [string, string][];
  body: Uint8Array;
  /** The body's size as it came (before decompression), and after. */
  wireSize: number;
  size: number;
  truncated: boolean;
  contentType: string;
  timings: Timings;
  redirects: Hop[];
  remote: string | null;
  tls: TlsInfo | null;
  /** The request as it went: its headers, for showing. */
  sent: { method: string; url: string; headers: [string, string][]; bodySize: number };
  unresolved: string[];
  at: number;
}

export function statusClass(status: number | null | undefined): 'info' | 'ok' | 'redirect' | 'client' | 'server' | 'none' {
  if (!status) return 'none';
  if (status < 200) return 'info';
  if (status < 300) return 'ok';
  if (status < 400) return 'redirect';
  if (status < 500) return 'client';
  return 'server';
}

export interface Cookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
}

/** A Set-Cookie header's cookie: its name, value and attributes. */
export function parseSetCookie(header: string): Cookie {
  const [pair, ...rest] = header.split(';');
  const eq = pair.indexOf('=');
  const attrs: Record<string, string | true> = {};
  for (const a of rest) {
    const t = a.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i < 0) attrs[t.toLowerCase()] = true;
    else attrs[t.slice(0, i).trim().toLowerCase()] = t.slice(i + 1).trim();
  }
  return { name: (eq < 0 ? pair : pair.slice(0, eq)).trim(), value: eq < 0 ? '' : pair.slice(eq + 1).trim(), attrs };
}
