// The open tab's editor: a request's (HTTP or WebSocket), a collection's
// or folder's settings, or an environment.

import { NodeMessage } from '@hyperpane/ui';
import { type Collection, type Context, type Environment, type HttpRequest, type WsRequest, effectiveAuth, folderChain } from '../../shared/index.ts';
import { scope } from '../../shared/vars.ts';
import { HttpEditor } from '../http/editor.tsx';
import { Live } from '../lib/live.ts';
import { type Tab, dirty } from '../lib/model.ts';
import { EnvironmentPanel } from '../panels/environment.tsx';
import { SettingsPanel } from '../panels/settings.tsx';
import { WsEditor } from '../ws/editor.tsx';

export function TabBody({
  tab,
  project,
  env,
  collection,
  collections,
  environments,
  live,
  onChange,
  onSave,
  saveCollection,
  saveEnvironment,
}: {
  tab: Tab;
  project: string;
  env: Environment | null;
  collection: Collection | null;
  collections: Collection[];
  environments: Environment[];
  live: Live;
  onChange(t: Tab): void;
  onSave(): void;
  saveCollection(c: Collection): void;
  saveEnvironment(e: Environment): void;
}) {
  if (tab.kind === 'environment') {
    const e = environments.find((x) => x.id === tab.id);
    return e ? <EnvironmentPanel env={e} onSave={saveEnvironment} /> : <NodeMessage>That environment is gone.</NodeMessage>;
  }
  if (tab.kind === 'settings') {
    const c = collections.find((x) => x.id === tab.collection);
    return c ? <SettingsPanel collection={c} folder={tab.folder} onSave={saveCollection} vars={scope(env, c)} /> : <NodeMessage>That collection is gone.</NodeMessage>;
  }
  const r = tab.request;
  const context: Context = { environment: env?.id ?? null, collection: collection?.id ?? null, folder: tab.folder };
  const vars = scope(env, collection);
  // What "Inherit" would use, and whose it is.
  const chain = collection ? folderChain(collection, tab.folder) : [];
  const from = [...chain].reverse().find((f) => f.auth.kind !== 'inherit');
  const inheritFrom = collection ? { name: from?.name ?? collection.name, auth: effectiveAuth({ ...r.auth, kind: 'inherit' }, collection, tab.folder) } : null;
  const common = {
    tabKey: tab.key,
    onSave,
    dirty: dirty(tab),
    live,
    project,
    context,
    vars,
    inheritFrom,
  };
  return r.type === 'ws' ? (
    <WsEditor {...common} request={r} onChange={(request: WsRequest) => onChange({ ...tab, request })} />
  ) : (
    <HttpEditor {...common} request={r} onChange={(request: HttpRequest) => onChange({ ...tab, request })} />
  );
}
