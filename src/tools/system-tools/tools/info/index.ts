import * as os from 'os';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(_args: Record<string, any>): Promise<string> {
    return JSON.stringify({
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        cpus: {
            model: os.cpus()[0]?.model || 'unknown',
            count: os.cpus().length,
        },
        memory: {
            total: os.totalmem(),
            free: os.freemem(),
            used: os.totalmem() - os.freemem(),
        },
        homedir: os.homedir(),
        tmpdir: os.tmpdir(),
        nodeVersion: process.version,
    }, null, 2);
}

export const systemInfoTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
