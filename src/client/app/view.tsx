// The window, laid out as Postman is: a sidebar (the environment, the
// collections or the history), a strip of open tabs, and the open tab's
// editor (an HTTP request and its answer, a WebSocket's chat, an event
// stream, a collection's settings, an environment).

import { useState } from 'react';
import { useProject } from '@hyperpane/sdk/client';
import { NodeButton, NodeMessage } from '@hyperpane/ui';
import { newHttp, newWs } from '../../shared/index.ts';
import { actions } from './actions.ts';
import { ImportDialog } from './import-dialog.tsx';
import { TabBody } from './tab-body.tsx';
import { TabStrip } from './tab-strip.tsx';
import { useWorkspace } from './workspace.ts';
import { dragFrom, useKept, useWidth } from '../lib/hooks.ts';
import { menuAt } from '../lib/menu.ts';
import { newRequest, tabName } from '../lib/model.ts';
import { NEW_MENU } from '../sidebar/menus.tsx';
import { Sidebar } from '../sidebar/sidebar.tsx';

export function RequestsView() {
  const project = useProject();
  if (!project) return <NodeMessage>Open a project: its collections and environments are kept in it.</NodeMessage>;
  return <RequestsWindow key={project.id} project={project.id} />;
}

export function RequestsWindow({ project }: { project: string }) {
  const w = useWorkspace(project);
  const { host, live, error, env, setEnv, collections, environments, history, tabs, active, activate, updateTab, envOf, collectionOf, activeEnv, saveCollection, saveEnvironment, openRequest, close } = w;
  const [side, setSide] = useKept('requests.sidebar', 240);
  const [sideOpen, setSideOpen] = useKept('requests.sideOpen', true);
  const [importing, setImporting] = useState(false);
  const [narrowSide, setNarrowSide] = useState(false);
  const [box, width] = useWidth<HTMLDivElement>();
  const { save, ops } = actions(w, { box, setImporting });

  if (error) return <NodeMessage error>{error}</NodeMessage>;

  // Narrow, the sidebar takes the whole window while it's shown: opening a
  // request shows the request instead.
  const narrow = width > 0 && width < 560;
  const showSide = narrow ? narrowSide : sideOpen;
  const toggleSide = () => (narrow ? setNarrowSide(!narrowSide) : setSideOpen(!sideOpen));
  return (
    <div ref={box} className="relative flex h-full min-w-0 text-xs text-[var(--node-fg)]">
      {showSide && (
        <>
          <aside className="flex min-h-0 flex-none flex-col" style={{ width: narrow ? '100%' : side }}>
            <Sidebar
              collections={collections}
              environments={environments}
              history={history}
              env={env}
              setEnv={setEnv}
              active={active?.kind === 'request' ? active.request.id : null}
              onHide={narrow ? () => setNarrowSide(false) : undefined}
              ops={{ ...ops, open: (...a) => (ops.open(...a), setNarrowSide(false)), openHistory: (h) => (ops.openHistory(h), setNarrowSide(false)) }}
            />
          </aside>
          {!narrow && (
            <div
              role="separator"
              aria-orientation="vertical"
              className="w-px flex-none cursor-col-resize bg-[var(--node-border)] px-px hover:bg-[var(--node-accent)]"
              onPointerDown={(e) => {
                const start = side;
                dragFrom(e, (dx) => setSide(Math.max(170, Math.min(440, Math.round(start + dx)))));
              }}
            />
          )}
        </>
      )}
      {(!narrow || !showSide) && (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabStrip
            tabs={tabs}
            active={active?.key ?? null}
            name={(t) => tabName(t, collections ?? [], (id) => envOf(id)?.name ?? 'Environment')}
            onActivate={activate}
            onClose={(k) => void close(k)}
            onNew={async (e) => {
              const id = await menuAt(host, e.currentTarget, NEW_MENU.slice(0, 3));
              if (id) openRequest(newRequest(id));
            }}
            sideOpen={showSide}
            toggleSide={toggleSide}
          />
          {active ? (
            <TabBody
              key={active.key}
              tab={active}
              project={project}
              env={activeEnv}
              collection={active.kind === 'request' ? collectionOf(active.collection) : null}
              collections={collections ?? []}
              environments={environments}
              live={live}
              onChange={(t) => updateTab(t.key, () => t)}
              onSave={() => void save(active)}
              saveCollection={saveCollection}
              saveEnvironment={saveEnvironment}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[var(--node-muted)]">
              <span>Open a request from the sidebar, or start one:</span>
              <div className="flex flex-wrap justify-center gap-1.5">
                <NodeButton onClick={() => openRequest(newHttp())}>HTTP request</NodeButton>
                <NodeButton onClick={() => openRequest(newWs())}>WebSocket</NodeButton>
                <NodeButton onClick={() => openRequest(newRequest('sse'))}>Event stream</NodeButton>
                <NodeButton onClick={() => setImporting(true)}>Import…</NodeButton>
              </div>
            </div>
          )}
        </main>
      )}
      {importing && (
        <ImportDialog
          project={project}
          onClose={() => setImporting(false)}
          onRequest={(r) => {
            setImporting(false);
            openRequest(r);
          }}
        />
      )}
    </div>
  );
}
