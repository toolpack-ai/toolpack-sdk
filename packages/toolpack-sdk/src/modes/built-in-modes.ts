import { ModeConfig } from './mode-types.js';
import { AGENT_WORKFLOW, CODING_WORKFLOW, CHAT_WORKFLOW } from '../workflows/presets.js';

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
    workflow: AGENT_WORKFLOW,
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
    workflow: CHAT_WORKFLOW,
    toolSearch: {
        alwaysLoadedTools: [
            'web.search',
            'web.fetch',
            'fs.read_file',
            'fs.list_dir',
        ]
    },
};

/**
 * Built-in mode: Coding
 *
 * Optimized for software development tasks. Uses concise step outputs with
 * minimal conversational text. Each step produces focused technical output,
 * and only the final step provides a summary of execution. Ideal for coding,
 refactoring, debugging, and file manipulation tasks where brevity matters.
 */
export const CODING_MODE: ModeConfig = {
    name: 'coding',
    displayName: 'Coding',
    description: 'Concise coding mode — minimal text, focused on file operations and code changes',
    systemPrompt: [
        'Coding assistant. Use tools to modify code.',
        'Be concise. No conversational filler.',
        'Show code changes clearly.',
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
    workflow: CODING_WORKFLOW,
    toolSearch: {
        alwaysLoadedTools: [
            'coding.read_code',
            'coding.search_code',
            'fs.read_file',
            'fs.write_file',
            'fs.list_dir',
            'skill.search',
            'skill.read',
            'web.search',
            'web.fetch',
        ]
    },
};

/**
 * All built-in modes.
 *
 * Three modes:
 * - Agent (full access + workflow)
 * - Coding (concise, coding-focused workflow)
 * - Chat (web access only)
 */
export const BUILT_IN_MODES: readonly ModeConfig[] = [
    AGENT_MODE,
    CODING_MODE,
    CHAT_MODE,
];

/**
 * The default mode name.
 */
export const DEFAULT_MODE_NAME = 'chat';
