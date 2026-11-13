// The cookies a response set, from its Set-Cookie headers.

import { parseSetCookie } from '../../shared/index.ts';

export function CookiesView({ cookies }: { cookies: ReturnType<typeof parseSetCookie>[] }) {
  if (!cookies.length) return <p className="px-3 py-3 text-[var(--node-muted)]">It set no cookies.</p>;
  const attr = (c: (typeof cookies)[0], k: string) => {
    const v = c.attrs[k];
    return v === true ? '✓' : (v ?? '');
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
      <table className="w-full table-fixed text-left font-mono text-[11px]">
        <thead className="text-[var(--node-muted)]">
          <tr>
            <th className="w-1/5 truncate font-normal">Name</th>
            <th className="w-1/4 truncate font-normal">Value</th>
            <th className="hidden truncate font-normal sm:table-cell">Domain</th>
            <th className="truncate font-normal">Path</th>
            <th className="hidden truncate font-normal md:table-cell">Expires</th>
            <th className="w-12 truncate font-normal">HttpOnly</th>
            <th className="w-12 truncate font-normal">Secure</th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((c, i) => (
            <tr key={i} className="border-t border-[var(--node-border)] align-top">
              <td className="truncate py-0.5" title={c.name}>
                {c.name}
              </td>
              <td className="py-0.5 break-all select-text">{c.value}</td>
              <td className="hidden truncate py-0.5 sm:table-cell">{attr(c, 'domain')}</td>
              <td className="truncate py-0.5">{attr(c, 'path')}</td>
              <td className="hidden truncate py-0.5 md:table-cell" title={String(c.attrs.expires ?? c.attrs['max-age'] ?? '')}>
                {attr(c, 'expires') || (c.attrs['max-age'] ? `max-age ${c.attrs['max-age']}` : 'Session')}
              </td>
              <td className="py-0.5">{attr(c, 'httponly')}</td>
              <td className="py-0.5">{attr(c, 'secure')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
