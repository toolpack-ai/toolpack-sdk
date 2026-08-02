import { ChildProcess } from 'child_process';

export interface ManagedProcess {
    id: string;
    command: string;
    cwd?: string;
    process: ChildProcess;
    startedAt: string;
    stdout: string;
    stderr: string;
}

// Per-Toolpack-instance process registry. One instance is created by
// ToolRuntimeContext and injected via ToolContext so concurrent tenants
// cannot list or kill each other's background processes.
export class ProcessRegistry {
    private processes: Map<string, ManagedProcess> = new Map();
    private nextId = 1;

    register(command: string, cwd: string | undefined, proc: ChildProcess): string {
        const id = `proc_${this.nextId++}`;
        const managed: ManagedProcess = {
            id, command, cwd, process: proc,
            startedAt: new Date().toISOString(),
            stdout: '', stderr: '',
        };

        proc.stdout?.on('data', (data: Buffer) => {
            managed.stdout += data.toString();
            if (managed.stdout.length > 1_000_000) managed.stdout = managed.stdout.slice(-500_000);
        });
        proc.stderr?.on('data', (data: Buffer) => {
            managed.stderr += data.toString();
            if (managed.stderr.length > 1_000_000) managed.stderr = managed.stderr.slice(-500_000);
        });

        this.processes.set(id, managed);
        return id;
    }

    get(id: string): ManagedProcess | undefined {
        return this.processes.get(id);
    }

    kill(id: string): boolean {
        const managed = this.processes.get(id);
        if (!managed) return false;
        const alive = managed.process.exitCode === null;
        if (alive) managed.process.kill('SIGTERM');
        return alive;
    }

    list(): { id: string; command: string; cwd?: string; startedAt: string; alive: boolean; pid: number | undefined }[] {
        return Array.from(this.processes.values()).map(p => ({
            id: p.id, command: p.command, cwd: p.cwd, startedAt: p.startedAt,
            alive: p.process.exitCode === null, pid: p.process.pid,
        }));
    }

    remove(id: string): boolean {
        return this.processes.delete(id);
    }
}

// Module-level default used by single-tenant callers and the backward-compat
// exported functions below. Multi-tenant callers receive a scoped instance
// via ToolContext.processRegistry.
export const defaultRegistry = new ProcessRegistry();

export function registerProcess(command: string, cwd: string | undefined, proc: ChildProcess): string {
    return defaultRegistry.register(command, cwd, proc);
}
export function getProcess(id: string): ManagedProcess | undefined {
    return defaultRegistry.get(id);
}
export function killProcess(id: string): boolean {
    return defaultRegistry.kill(id);
}
export function listProcesses(): ReturnType<ProcessRegistry['list']> {
    return defaultRegistry.list();
}
export function removeProcess(id: string): boolean {
    return defaultRegistry.remove(id);
}
