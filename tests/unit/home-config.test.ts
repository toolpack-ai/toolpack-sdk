import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getUserHomeDir,
    getGlobalToolpackDir,
    getGlobalConfigDir,
    getGlobalConfigPath,
    getLocalToolpackDir,
    getLocalConfigDir,
    getLocalConfigPath,
    ensureGlobalConfigDir,
    ensureLocalConfigDir
} from '../../src/utils/home-config.js';

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    return {
        ...actual,
        homedir: vi.fn(),
    };
});

describe('home-config utilities', () => {
    let mockHomedir: string;
    let tmpWorkspace: string;

    beforeEach(() => {
        mockHomedir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-home-'));
        vi.mocked(os.homedir).mockReturnValue(mockHomedir);
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-workspace-'));
    });

    afterEach(() => {
        vi.clearAllMocks();
        fs.rmSync(mockHomedir, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    });

    it('getUserHomeDir should return the mocked homedir', () => {
        expect(getUserHomeDir()).toBe(mockHomedir);
    });

    it('getGlobalToolpackDir should be .toolpack inside homedir', () => {
        expect(getGlobalToolpackDir()).toBe(path.join(mockHomedir, '.toolpack'));
    });

    it('getGlobalConfigDir should be .toolpack/config inside homedir', () => {
        expect(getGlobalConfigDir()).toBe(path.join(mockHomedir, '.toolpack', 'config'));
    });

    it('getGlobalConfigPath should be toolpack.config.json inside global config dir', () => {
        expect(getGlobalConfigPath()).toBe(path.join(mockHomedir, '.toolpack', 'config', 'toolpack.config.json'));
    });

    it('getLocalToolpackDir should be .toolpack inside workspace', () => {
        expect(getLocalToolpackDir(tmpWorkspace)).toBe(path.join(tmpWorkspace, '.toolpack'));
    });

    it('getLocalConfigDir should be .toolpack/config inside workspace', () => {
        expect(getLocalConfigDir(tmpWorkspace)).toBe(path.join(tmpWorkspace, '.toolpack', 'config'));
    });

    it('getLocalConfigPath should be toolpack.config.json inside local config dir', () => {
        expect(getLocalConfigPath(tmpWorkspace)).toBe(path.join(tmpWorkspace, '.toolpack', 'config', 'toolpack.config.json'));
    });

    it('ensureGlobalConfigDir should create the directory if it does not exist', () => {
        const globalConfigDir = getGlobalConfigDir();
        expect(fs.existsSync(globalConfigDir)).toBe(false);

        ensureGlobalConfigDir();

        expect(fs.existsSync(globalConfigDir)).toBe(true);
    });

    it('ensureLocalConfigDir should create the directory if it does not exist', () => {
        const localConfigDir = getLocalConfigDir(tmpWorkspace);
        expect(fs.existsSync(localConfigDir)).toBe(false);

        ensureLocalConfigDir(tmpWorkspace);

        expect(fs.existsSync(localConfigDir)).toBe(true);
    });
});
