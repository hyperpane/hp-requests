// A request's (or a folder's, or a collection's) auth: inherited, none,
// a bearer token, Basic, an API key.

import type { Auth, AuthKind } from '../../shared/index.ts';
import { Picker } from '../ui/picker.tsx';
import { VarInput } from '../ui/var-input.tsx';

export const AUTH_KINDS: { id: AuthKind; label: string }[] = [
  { id: 'inherit', label: 'Inherit from the folder or collection' },
  { id: 'none', label: 'No auth' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'basic', label: 'Basic' },
  { id: 'apikey', label: 'API key' },
];

export function AuthEditor({ auth, onChange, vars, inheritFrom, canInherit = true }: { auth: Auth; onChange(a: Auth): void; vars: Map<string, string>; inheritFrom: { name: string; auth: Auth } | null; canInherit?: boolean }) {
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });
  const field = (label: string, k: 'token' | 'username' | 'password' | 'key' | 'value', placeholder?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[var(--node-muted)]">{label}</span>
      <VarInput value={auth[k]} vars={vars} onChange={(v) => set({ [k]: v })} placeholder={placeholder} />
    </label>
  );
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <Picker label="Auth" className="w-64 max-w-full" value={auth.kind} options={AUTH_KINDS.filter((k) => canInherit || k.id !== 'inherit')} onChange={(kind) => set({ kind: kind as AuthKind })} />
      {auth.kind === 'inherit' && (
        <p className="text-[var(--node-muted)]">
          {inheritFrom
            ? inheritFrom.auth.kind === 'none'
              ? `${inheritFrom.name} has no auth: none is sent.`
              : `Uses ${inheritFrom.name}’s: ${AUTH_KINDS.find((k) => k.id === inheritFrom.auth.kind)?.label}.`
            : 'Not in a collection: no auth is sent. Save it in a collection to use the collection’s.'}
        </p>
      )}
      {auth.kind === 'none' && <p className="text-[var(--node-muted)]">No auth is sent.</p>}
      {auth.kind === 'bearer' && field('Token', 'token', '{{token}}')}
      {auth.kind === 'basic' && (
        <>
          {field('Username', 'username')}
          {field('Password', 'password')}
        </>
      )}
      {auth.kind === 'apikey' && (
        <>
          {field('Name', 'key', 'X-API-Key')}
          {field('Value', 'value', '{{apiKey}}')}
          <Picker
            label="Where"
            className="w-48"
            value={auth.in}
            options={[
              { id: 'header', label: 'In a header' },
              { id: 'query', label: 'In the query' },
            ]}
            onChange={(v) => set({ in: v as 'header' | 'query' })}
          />
        </>
      )}
      {(auth.kind === 'bearer' || auth.kind === 'basic' || auth.kind === 'apikey') && (
        <p className="text-[11px] text-[var(--node-muted)]">An Authorization header of your own (or the key’s) wins over this. Keep secrets in an environment’s secret variables: they stay on this machine.</p>
      )}
    </div>
  );
}
