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

const processes: Map<string, ManagedProcess> = new Map();
let nextId = 1;

export function registerProcess(command: string, cwd: string | undefined, proc: ChildProcess): string {
    const id = `proc_${nextId++}`;
    const managed: ManagedProcess = {
        id,
        command,
        cwd,
        process: proc,
        startedAt: new Date().toISOString(),
        stdout: '',
        stderr: '',
    };

    proc.stdout?.on('data', (data: Buffer) => {
        managed.stdout += data.toString();
        // Cap buffer at 1MB
        if (managed.stdout.length > 1_000_000) {
            managed.stdout = managed.stdout.slice(-500_000);
        }
    });

    proc.stderr?.on('data', (data: Buffer) => {
        managed.stderr += data.toString();
        if (managed.stderr.length > 1_000_000) {
            managed.stderr = managed.stderr.slice(-500_000);
        }
    });

    proc.on('exit', () => {
        // Keep in registry for output retrieval, but mark as done
    });

    processes.set(id, managed);
    return id;
}

export function getProcess(id: string): ManagedProcess | undefined {
    return processes.get(id);
}

export function killProcess(id: string): boolean {
    const managed = processes.get(id);
    if (!managed) return false;

    const alive = managed.process.exitCode === null;
    if (alive) {
        managed.process.kill('SIGTERM');
    }
    return alive;
}

export function listProcesses(): { id: string; command: string; cwd?: string; startedAt: string; alive: boolean; pid: number | undefined }[] {
    return Array.from(processes.values()).map(p => ({
        id: p.id,
        command: p.command,
        cwd: p.cwd,
        startedAt: p.startedAt,
        alive: p.process.exitCode === null,
        pid: p.process.pid,
    }));
}

export function removeProcess(id: string): boolean {
    return processes.delete(id);
}
