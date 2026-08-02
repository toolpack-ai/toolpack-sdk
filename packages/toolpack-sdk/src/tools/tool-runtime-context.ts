import { ProcessRegistry } from './exec-tools/process-registry.js';
import { CloneState } from './git-tools/tools/clone/clone-state.js';
import { GithubTokenStore } from './github-tools/auth.js';

// One instance per Toolpack. Created by ToolRegistry.loadBuiltIn() and
// stored on the registry so both AIClient and startMcpServer can inject
// it into ToolContext without any public API change.
export class ToolRuntimeContext {
    readonly processRegistry  = new ProcessRegistry();
    readonly cloneState       = new CloneState();
    readonly githubTokenStore = new GithubTokenStore();
}
