import * as vscode from 'vscode';

export type AuthType = 'authCode' | 'apiToken' | 'none';
export type UploadChannel =
  'telegram' | 'cfr2' | 's3' | 'discord' | 'huggingface' | 'webdav';
export type UploadNameType = 'default' | 'index' | 'origin' | 'short';

export type Config = {
  serverUrl: string;
  authType: AuthType;
  uploadChannel: UploadChannel;
  channelName: string;
  uploadFolder: string;
  uploadNameType: UploadNameType;
  expire: string;
  serverCompress: boolean;
  autoRetry: boolean;
  customCdn: string;
  uploadRemoteImages: boolean;
  remoteWhitelist: string[];
  pasteUpload: boolean;
};

export const AUTH_TYPES: readonly AuthType[] = ['authCode', 'apiToken', 'none'];
export const UPLOAD_CHANNELS: readonly UploadChannel[] = [
  'telegram',
  'cfr2',
  's3',
  'discord',
  'huggingface',
  'webdav',
];
export const UPLOAD_NAME_TYPES: readonly UploadNameType[] = [
  'default',
  'index',
  'origin',
  'short',
];

function enumOr<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// 尾部统一为单个 /；空串表示未启用
function normalizeCdn(value: string): string {
  const trimmed = value.trim();
  return trimmed === '' ? '' : trimmed.replace(/\/+$/, '') + '/';
}

// 纯函数，供单测；与 vscode 绑定分离（T1 设计 §2.1）
export function normalize(raw: Record<string, unknown>): Config {
  return {
    serverUrl: str(raw.serverUrl).trim().replace(/\/+$/, ''),
    authType: enumOr(raw.authType, AUTH_TYPES, 'authCode'),
    uploadChannel: enumOr(raw.uploadChannel, UPLOAD_CHANNELS, 'telegram'),
    channelName: str(raw.channelName).trim(),
    uploadFolder: str(raw.uploadFolder).trim(),
    uploadNameType: enumOr(raw.uploadNameType, UPLOAD_NAME_TYPES, 'default'),
    expire: str(raw.expire).trim(),
    serverCompress: raw.serverCompress !== false,
    autoRetry: raw.autoRetry !== false,
    customCdn: normalizeCdn(str(raw.customCdn)),
    uploadRemoteImages: raw.uploadRemoteImages === true,
    remoteWhitelist: Array.isArray(raw.remoteWhitelist)
      ? raw.remoteWhitelist
          .filter((e): e is string => typeof e === 'string')
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e !== '')
      : [],
    pasteUpload: raw.pasteUpload !== false,
  };
}

export function getConfig(resource?: vscode.Uri): Config {
  const cfg = vscode.workspace.getConfiguration('imgbedUploader', resource);
  return normalize({
    serverUrl: cfg.get('serverUrl'),
    authType: cfg.get('authType'),
    uploadChannel: cfg.get('uploadChannel'),
    channelName: cfg.get('channelName'),
    uploadFolder: cfg.get('uploadFolder'),
    uploadNameType: cfg.get('uploadNameType'),
    expire: cfg.get('expire'),
    serverCompress: cfg.get('serverCompress'),
    autoRetry: cfg.get('autoRetry'),
    customCdn: cfg.get('customCdn'),
    uploadRemoteImages: cfg.get('uploadRemoteImages'),
    remoteWhitelist: cfg.get('remoteWhitelist'),
    pasteUpload: cfg.get('pasteUpload'),
  });
}
