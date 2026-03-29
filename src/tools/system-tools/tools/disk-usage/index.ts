import { execSync } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

async function execute(args: Record<string, any>): Promise<string> {
    const targetPath = (args.path || (process.platform === 'win32' ? 'C:' : '/')) as string;
    const isWindows = process.platform === 'win32';

    try {
        if (isWindows) {
            // Windows: Use wmic to get disk info
            // Extract drive letter from path (e.g., C:\path -> C:)
            const driveLetter = targetPath.match(/^([A-Za-z]:)/)?.[1] || 'C:';
            const output = execSync(`wmic logicaldisk where "DeviceID='${driveLetter}'" get DeviceID,Size,FreeSpace,FileSystem /format:csv`, {
                encoding: 'utf-8',
                timeout: 5000,
            });

            const lines = output.trim().split('\n').filter(line => line.trim());
            if (lines.length < 2) {
                return output;
            }

            // Parse CSV output (Node,DeviceID,FileSystem,FreeSpace,Size)
            const data = lines[1].split(',');
            const size = parseInt(data[4]) || 0;
            const free = parseInt(data[3]) || 0;
            const used = size - free;
            const usePercent = size > 0 ? Math.round((used / size) * 100) : 0;

            return JSON.stringify({
                path: targetPath,
                filesystem: data[2] || 'NTFS',
                size: `${(size / (1024 ** 3)).toFixed(1)}G`,
                used: `${(used / (1024 ** 3)).toFixed(1)}G`,
                available: `${(free / (1024 ** 3)).toFixed(1)}G`,
                usePercent: `${usePercent}%`,
                mountedOn: data[1] || driveLetter,
            }, null, 2);
        } else {
            // Unix: Use df command
            const output = execSync(`df -h "${targetPath}"`, {
                encoding: 'utf-8',
                timeout: 5000,
            });

            // Parse df output
            const lines = output.trim().split('\n');
            if (lines.length < 2) {
                return output;
            }

            const parts = lines[1].split(/\s+/);
            return JSON.stringify({
                path: targetPath,
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usePercent: parts[4],
                mountedOn: parts[5],
            }, null, 2);
        }
    } catch (error: any) {
        throw new Error(`Failed to get disk usage for ${targetPath}: ${error.message}`);
    }
}

export const systemDiskUsageTool: ToolDefinition = {
    name,
    displayName,
    description,
    parameters,
    category,
    execute,
};
