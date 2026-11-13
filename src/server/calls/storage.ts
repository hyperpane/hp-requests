// Collections, environments and the history: read, changed, and watched.

import type { Deps, Group } from './context.ts';

export function storage({ store }: Deps): Group {
  return {
    calls: {
      state: ({ project }) => store.state(String(project)),
      saveCollection: ({ project, collection }) => store.saveCollection(String(project), collection),
      removeCollection: ({ project, id }) => store.removeCollection(String(project), String(id)).then(() => null),
      orderCollections: ({ project, ids }) => store.orderCollections(String(project), Array.isArray(ids) ? ids.map(String) : []).then(() => null),
      saveEnvironment: ({ project, environment }) => store.saveEnvironment(String(project), environment),
      removeEnvironment: ({ project, id }) => store.removeEnvironment(String(project), String(id)).then(() => null),
      removeHistory: ({ project, id }) => store.removeHistory(String(project), id ? String(id) : null).then(() => null),
    },
    subscriptions: {
      watch: ({ project }, out) => store.watch(String(project), (s) => out.emit(s), out.signal),
    },
  };
}
