import { ModeConfig } from './mode-types.js';

/**
 * Built-in mode: Agent
 *
 * Full autonomous access for agents that need to read, write, and execute.
 * All tools are available. Suitable for coding agents, DevOps bots, terminal AI,
 * file management agents, or any autonomous workflow.
 */
export const AGENT_MODE: ModeConfig = {
    name: 'agent',
    displayName: 'Agent',
    description: 'Full autonomous access — read, write, execute, browse',
    systemPrompt: [
        'You are an autonomous AI agent with full access to all available tools.',
        'You must use the tools provided to accomplish tasks end-to-end proactively.',
        'If you require a capability that is not listed in your current tools, ALWAYS use `tool.search` to find it before improvising or giving up.',
        'Before considering a tool to call, make sure that is the right tool for the job as per the users prompt.',
        'Verify your actions and check for success or failure states.',
        'Explain your actions briefly as you go.',
    ].join(' '),
    allowedToolCategories: [],
    blockedToolCategories: [],
    allowedTools: [],
    blockedTools: [],
    blockAllTools: false,
    baseContext: {
        includeWorkingDirectory: true,
        includeToolCategories: true,
    },
    workflow: {
        planning: { enabled: true },
        steps: {
            enabled: true,
            retryOnFailure: true,
            allowDynamicSteps: true,
        },
        progress: { enabled: true },
    },
    toolSearch: {
        alwaysLoadedTools: [
            'fs.read_file',
            'fs.write_file',
            'fs.list_dir',
            'web.search',
            'web.fetch',
            'skill.search',
            'skill.read',
        ]
    },
};

/**
 * Built-in mode: Chat
 *
 * Conversational mode with web access for general assistance.
 * Can search the web, fetch content, and make HTTP requests.
 * No local filesystem, command execution, or code modification.
 * Ideal for general Q&A, research, and online assistance.
 */
export const CHAT_MODE: ModeConfig = {
    name: 'chat',
    displayName: 'Chat',
    description: 'Conversational assistant with web access',
    systemPrompt: [
        'You are a conversational AI assistant with web access.',
        'You can search the web, fetch online content, and make HTTP requests.',
        'You do NOT have access to the local filesystem, command execution, or code modification.',
        'Answer questions using your knowledge and web tools when helpful.',
        'If the user asks for local file operations or code changes,',
        'explain that you are in Chat mode and suggest they switch to Agent mode.',
    ].join(' '),
    allowedToolCategories: ['network'],
    blockedToolCategories: ['filesystem', 'execution', 'system', 'coding', 'git', 'database'],
    allowedTools: [],
    blockedTools: [],
    blockAllTools: false,
    baseContext: {
        includeWorkingDirectory: false,
        includeToolCategories: true,
    },
    workflow: {
        planning: { enabled: false },
        steps: { enabled: false },
    },
    toolSearch: {
        alwaysLoadedTools: [
            'web.search',
            'web.fetch'
        ]
    },
};

/**
 * All built-in modes.
 *
 * Two modes: Agent (full access + workflow) and Chat (web access only)
 */
export const BUILT_IN_MODES: readonly ModeConfig[] = [
    AGENT_MODE,
    CHAT_MODE,
];

/**
 * The default mode name.
 */
export const DEFAULT_MODE_NAME = 'chat';
