// The client part: the Requests window. Requests go from the server part, on
// the server, not from this frame.

import { mount } from '@hyperpane/sdk/client';
import { NodeMessage } from '@hyperpane/ui';
import { RequestsView } from './app/view.tsx';

mount((host) => (host.view.type === 'node' && host.view.kind === 'requests' ? <RequestsView /> : <NodeMessage error>Requests has no “{host.view.type}” view here.</NodeMessage>));
