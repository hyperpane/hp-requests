// The server part: sends requests, holds WebSockets and event streams
// open, and keeps collections, environments and the history.

import { serve } from '@hyperpane/sdk/server';
import { plugin } from './plugin.ts';

serve(plugin);
