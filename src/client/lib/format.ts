// Text for the window: JSON made readable (its variables kept), sizes,
// times and clock times.

/** JSON made readable. Variables outside strings ({"n": {{count}}}) are
 * kept as they were: they aren't JSON, so they're swapped out first. */
export function beautify(text: string): string {
  const found: { name: string; quoted: boolean }[] = [];
  let inString = false;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && inString) {
      out += c + (text[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') inString = !inString;
    const m = c === '{' && text[i + 1] === '{' ? /^\{\{[^{}]+\}\}/.exec(text.slice(i)) : null;
    if (m) {
      const k = found.length;
      found.push({ name: m[0], quoted: inString });
      out += inString ? `__hpv${k}__` : `"__hpv${k}__"`;
      i += m[0].length - 1;
      continue;
    }
    out += c;
  }
  let pretty = JSON.stringify(JSON.parse(out), null, 2);
  found.forEach((f, k) => {
    pretty = pretty.replace(f.quoted ? `__hpv${k}__` : `"__hpv${k}__"`, () => f.name);
  });
  return pretty;
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`);
export const clock = (at: number) => {
  const d = new Date(at);
  return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};
