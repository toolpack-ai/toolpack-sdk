import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';

export function getGit(cwd?: string): SimpleGit {
    const options: Partial<SimpleGitOptions> = {
        baseDir: cwd || process.cwd(),
        binary: 'git',
        maxConcurrentProcesses: 6,
    };
    return simpleGit(options);
}
