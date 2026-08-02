import { ToolDefinition, ToolContext } from '../../../types.js';
import { defaultRegistry } from '../../process-registry.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>, ctx?: ToolContext): Promise<string> {
    const processId = args.process_id as string;
    const numLines = typeof args.lines === 'number' ? Math.max(1, Math.floor(args.lines)) : 20;

    if (!processId) {
        throw new Error('process_id is required');
    }

    const registry = ctx?.processRegistry ?? defaultRegistry;
    const managed = registry.get(processId);
    if (!managed) {
        return JSON.stringify({
            error: `Process not found: ${processId}`,
            hint: 'Use exec.run_background to start a process first, then pass its id here.',
        });
    }

    const alive = managed.process.exitCode === null;
    const exitCode = managed.process.exitCode;

    const stdoutLines = managed.stdout.split('\n');
    const tailLines = stdoutLines.slice(-numLines).join('\n').trim();

    const stderrLines = managed.stderr.split('\n').filter(l => l.trim());
    const lastStderr = stderrLines.slice(-3).join('\n').trim();

    return JSON.stringify({
        id: processId,
        alive,
        exitCode,
        lastLines: tailLines || '(no output yet)',
        lastStderr: lastStderr || '',
        totalStdoutLines: stdoutLines.length,
    });
}

export const execTailOutputTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
