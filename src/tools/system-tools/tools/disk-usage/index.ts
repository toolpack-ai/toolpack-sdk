import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { ToolDefinition } from '../../../types.js';
import { name, displayName, description, parameters, category } from './schema.js';

function bytesToHuman(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(1)}${units[unitIndex]}`;
}

async function execute(args: Record<string, any>): Promise<string> {
    const userPath = args.path as string | undefined;
    let targetPath = userPath || (process.platform === 'win32' ? os.tmpdir() : '/');
    targetPath = path.resolve(targetPath);
    const isWindows = process.platform === 'win32';

    try {
        // Prefer filesystem query via statfs as a cross-platform base implementation.
        const stat = fs.statfsSync(targetPath);

        const total = BigInt(stat.blocks) * BigInt(stat.bsize);
        const available = BigInt(stat.bavail) * BigInt(stat.bsize);
        const free = BigInt(stat.bfree) * BigInt(stat.bsize);
        const used = total - free;
        const usePercent = total > 0 ? Number((used * BigInt(100)) / total) : 0;

        return JSON.stringify({
            path: targetPath,
            filesystem: 'statfs',
            size: bytesToHuman(Number(total)),
            used: bytesToHuman(Number(used)),
            available: bytesToHuman(Number(available)),
            usePercent: `${usePercent}%`,
            mountedOn: targetPath,
        }, null, 2);
    } catch (statfsError: any) {
        // Fallback to OS-specific commands when statfs fails or is unsupported.
        try {
            if (isWindows) {
                const driveLetter = path.parse(targetPath).root.replace(/\\$/, '') || 'C:';
                const psCommand = `Get-PSDrive -Name ${driveLetter.replace(':', '')} | Select-Object @{n='Drive';e={$_.Name+':'}},@{n='Used';e={$_.Used}},@{n='Free';e={$_.Free}},@{n='Total';e={$_.Used+$_.Free}} | ConvertTo-Json`;
                const output = execSync(psCommand, {
                    encoding: 'utf-8',
                    timeout: 5000,
                    shell: 'powershell.exe',
                });

                const data = JSON.parse(output.trim());
                const total = data.Total || 0;
                const free = data.Free || 0;
                const used = data.Used || 0;
                const usePercent = total > 0 ? Math.round((used / total) * 100) : 0;

                return JSON.stringify({
                    path: targetPath,
                    filesystem: data.Name || 'NTFS',
                    size: `${(total / (1024 ** 3)).toFixed(1)}G`,
                    used: `${(used / (1024 ** 3)).toFixed(1)}G`,
                    available: `${(free / (1024 ** 3)).toFixed(1)}G`,
                    usePercent: `${usePercent}%`,
                    mountedOn: data.Drive || `${driveLetter}`,
                }, null, 2);
            }

            // Unix fallback using df.
            const output = execSync(`df -h "${targetPath}"`, {
                encoding: 'utf-8',
                timeout: 5000,
            });

            const lines = output.trim().split('\n');
            if (lines.length < 2) {
                return output;
            }

            const parts = lines[1].split(/\s+/);
            return JSON.stringify({
                path: targetPath,
                filesystem: parts[0] || 'unknown',
                size: parts[1] || 'unknown',
                used: parts[2] || 'unknown',
                available: parts[3] || 'unknown',
                usePercent: parts[4] || 'unknown',
                mountedOn: parts[5] || 'unknown',
            }, null, 2);
        } catch (cmdError: any) {
            throw new Error(`Failed to get disk usage for ${targetPath}: ${statfsError?.message || statfsError}; fallback error: ${cmdError.message}`);
        }
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
