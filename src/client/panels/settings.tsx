// A collection's (or a folder's) settings: its name, variables and auth,
// saved as they're changed.

import { useEffect, useRef, useState } from 'react';
import { NodeInput } from '@hyperpane/ui';
import { type Auth, type Collection, type KV, folderChain } from '../../shared/index.ts';
import { AuthEditor } from '../http/auth.tsx';
import { useKept, useSoon } from '../lib/hooks.ts';
import { findItem, mapItem } from '../lib/model.ts';
import { KVTable } from '../ui/kv-table.tsx';
import { Tabs } from '../ui/tabs.tsx';

export function SettingsPanel({ collection, folder, onSave, vars }: { collection: Collection; folder: string | null; onSave(c: Collection): void; vars: Map<string, string> }) {
  const [c, setC] = useState(collection);
  // Changes from elsewhere (another window, a pull) come in when this one
  // has nothing waiting.
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) setC(collection);
  }, [JSON.stringify(collection)]);
  useSoon(c, (v) => {
    pending.current = false;
    onSave(v);
  });
  const change = (next: Collection) => {
    pending.current = true;
    setC(next);
  };
  const [tab, setTab] = useKept<'variables' | 'auth'>('requests.settingsTab', 'variables');
  const f = folder ? findItem(c.items, folder)?.item : null;
  if (folder && (!f || f.type !== 'folder')) return <p className="p-3 text-[var(--node-muted)]">That folder is gone.</p>;
  const chain = folderChain(c, folder);
  const above = chain.slice(0, -1).reverse().find((x) => x.auth.kind !== 'inherit');
  const name = f ? f.name : c.name;
  const rename = (n: string) => change(f ? { ...c, items: mapItem(c.items, f.id, (x) => ({ ...x, name: n })) } : { ...c, name: n });
  const setAuth = (auth: Auth) => change(f ? { ...c, items: mapItem(c.items, f.id, (x) => ({ ...x, auth }) as typeof x) } : { ...c, auth });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 px-3 pt-3 pb-2">
        <span className="flex-none text-[var(--node-muted)]">{f ? 'Folder' : 'Collection'}</span>
        <NodeInput className="h-7 min-w-0 flex-1 font-medium" value={name} onChange={(e) => rename(e.target.value)} aria-label="Name" />
      </div>
      <Tabs
        value={f ? 'auth' : tab}
        onChange={setTab}
        tabs={f ? [{ id: 'auth', name: 'Auth' }] : [
          { id: 'variables', name: 'Variables' },
          { id: 'auth', name: 'Auth' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!f && tab === 'variables' ? (
          <>
            <KVTable rows={c.variables} vars={vars} keyName="Variable" onChange={(variables: KV[]) => change({ ...c, variables })} />
            <p className="mt-2 text-[11px] text-[var(--node-muted)]">
              Use them as {'{{name}}'} in this collection’s requests. The chosen environment’s variables win over these. They’re kept in the project: put secrets in an environment’s secret variables instead.
            </p>
          </>
        ) : (
          <>
            <AuthEditor
              auth={f ? f.auth : c.auth}
              onChange={setAuth}
              vars={vars}
              canInherit={!!f}
              inheritFrom={f ? (above ? { name: above.name, auth: above.auth } : { name: c.name, auth: c.auth }) : null}
            />
            <p className="mt-3 text-[11px] text-[var(--node-muted)]">Requests in it whose auth is “Inherit” use this.</p>
          </>
        )}
      </div>
    </div>
  );
}
