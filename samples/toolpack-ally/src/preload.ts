import { contextBridge } from 'electron';
import os from 'node:os';

export type ToolpackAllyAPI = {
  appName: string;
  version: string;
  platform: NodeJS.Platform;
  friendlyPlatform: string;
};

const api: ToolpackAllyAPI = {
  appName: 'Toolpack Ally',
  version: '1.0.0',
  platform: process.platform,
  friendlyPlatform: `${os.type()} ${os.release()}`,
};

contextBridge.exposeInMainWorld('toolpackAlly', api);
