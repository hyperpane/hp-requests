// Words for a POSIX shell, both ways: quoted for a command, and split
// from one as the shell would split it.

/** A word for a POSIX shell: in single quotes when it needs them. */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A command's words, as a POSIX shell splits them: quotes, backslashes,
 * $'…', and lines continued with a backslash. */
export function shellWords(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  const s = cmd.replace(/\\\r?\n/g, ' ');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
      i++;
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new Error('A quote (\') isn’t closed.');
      cur += s.slice(i + 1, end);
      has = true;
      i = end + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '0': '\0' };
          if (n === 'x') {
            const hex = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 2))?.[0] ?? '';
            cur += String.fromCharCode(parseInt(hex || '0', 16));
            i += 2 + hex.length;
          } else if (n === 'u' || n === 'U') {
            const hex = /^[0-9a-fA-F]{1,8}/.exec(s.slice(i + 2))?.[0] ?? '';
            cur += String.fromCodePoint(parseInt(hex || '0', 16));
            i += 2 + hex.length;
          } else {
            cur += map[n] ?? `\\${n}`;
            i += 2;
          }
        } else cur += s[i++];
      }
      if (i >= s.length) throw new Error('A quote ($\') isn’t closed.');
      i++;
      has = true;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else cur += s[i++];
      }
      if (i >= s.length) throw new Error('A quote (") isn’t closed.');
      i++;
      has = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1];
      has = true;
      i += 2;
    } else {
      cur += c;
      has = true;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}
