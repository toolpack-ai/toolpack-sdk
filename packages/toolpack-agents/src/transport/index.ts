// Transport layer for agent-to-agent communication

// Types
export type { AgentTransport, AgentRegistryTransportOptions } from './types.js';

// Local transport (same process)
export { LocalTransport } from './local-transport.js';

// JSON-RPC transport (cross-process)
export { JsonRpcTransport } from './jsonrpc-transport.js';
export { AgentJsonRpcServer } from './jsonrpc-server.js';
