// Library entry point — what `import { AvdClient } from 'avd'` resolves
// to. The daemon entry stays at `dist/daemon.js` (and is also reachable
// as `avd/daemon`); this barrel keeps the public client surface narrow
// so chunk-5d / chunk-6 don't accidentally rely on internals.

export { AvdClient } from './client.js';
export type { StartSessionAck, StartSessionInput, SubscribeAck, SubscribeOptions } from './client.js';
