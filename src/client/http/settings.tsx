// A request's settings: the timeout, redirects, TLS errors.

import { NodeInput } from '@hyperpane/ui';
import type { HttpRequest } from '../../shared/index.ts';

export function SettingsEditor({ r, set }: { r: HttpRequest; set(p: Partial<HttpRequest>): void }) {
  const s = r.settings;
  const put = (patch: Partial<HttpRequest['settings']>) => set({ settings: { ...s, ...patch } });
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <label className="flex items-center gap-2">
        <span className="flex-1">Timeout</span>
        <NodeInput type="number" min={0} step={1000} className="w-24" value={s.timeout} onChange={(e) => put({ timeout: Math.max(0, Number(e.target.value) || 0) })} />
        <span className="w-16 text-[var(--node-muted)]">ms (0: none)</span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={s.followRedirects} onChange={(e) => put({ followRedirects: e.target.checked })} />
        <span>
          Follow redirects
          <span className="block text-[11px] text-[var(--node-muted)]">Up to 10; each is listed under Timings. Off: the 3xx is the answer.</span>
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={s.insecure} onChange={(e) => put({ insecure: e.target.checked })} />
        <span>
          Ignore TLS errors
          <span className="block text-[11px] text-[var(--node-muted)]">Send even when the certificate isn’t trusted (self-signed, expired, another name).</span>
        </span>
      </label>
    </div>
  );
}
