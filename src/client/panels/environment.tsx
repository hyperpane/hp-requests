// An environment: its name and variables, the secret ones kept on this
// machine; saved as they're changed.

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { NodeInput, ToolButton } from '@hyperpane/ui';
import type { EnvVar, Environment } from '../../shared/index.ts';
import { useSoon } from '../lib/hooks.ts';
import { KVTable } from '../ui/kv-table.tsx';

export function EnvironmentPanel({ env, onSave }: { env: Environment; onSave(e: Environment): void }) {
  const [e, setE] = useState(env);
  const pending = useRef(false);
  const [shown, setShown] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!pending.current) setE(env);
  }, [JSON.stringify(env)]);
  useSoon(e, (v) => {
    pending.current = false;
    onSave(v);
  });
  const change = (next: Environment) => {
    pending.current = true;
    setE(next);
  };
  const vars = new Map(e.vars.filter((v) => v.enabled).map((v) => [v.key, v.value]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 px-3 pt-3 pb-2">
        <span className="flex-none text-[var(--node-muted)]">Environment</span>
        <NodeInput className="h-7 min-w-0 flex-1 font-medium" value={e.name} onChange={(x) => change({ ...e, name: x.target.value })} aria-label="Name" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <KVTable
          rows={e.vars.map((v, i) => (v.secret && !shown.has(i) ? { ...v, value: v.value ? '••••••••' : '' } : v))}
          vars={vars}
          keyName="Variable"
          onChange={(rows) =>
            change({
              ...e,
              vars: rows.map((r, i) => {
                const old = e.vars[i];
                // A hidden secret's dots aren't its value: keep the value
                // unless it was typed over.
                const masked = old?.secret && !shown.has(i);
                const value = masked && r.value === (old.value ? '••••••••' : '') ? old.value : r.value;
                return { secret: old?.secret ?? false, ...r, value } as EnvVar;
              }),
            })
          }
          extra={(_row, i) => {
            const v = e.vars[i];
            return (
              <>
                {v.secret && <ToolButton label={shown.has(i) ? 'Hide' : 'Show'} icon={shown.has(i) ? EyeOff : Eye} onClick={() => setShown((s) => new Set(s.has(i) ? [...s].filter((x) => x !== i) : [...s, i]))} />}
                <ToolButton
                  label={v.secret ? 'Secret: kept on this machine only. Click to share it with the project' : 'Shared with the project. Click to keep it on this machine only'}
                  icon={v.secret ? Lock : LockOpen}
                  active={v.secret}
                  onClick={() => change({ ...e, vars: e.vars.map((x, j) => (j === i ? { ...x, secret: !x.secret } : x)) })}
                />
              </>
            );
          }}
        />
        <p className="mt-2 text-[11px] text-[var(--node-muted)]">
          Kept in the project (.hyperpane/requests/environments.json), to commit with it. A secret variable (the lock) keeps its name there and its value on this machine only.
        </p>
      </div>
    </div>
  );
}
