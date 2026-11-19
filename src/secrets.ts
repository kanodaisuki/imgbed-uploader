import * as vscode from 'vscode';

// 凭据存 SecretStorage，不进 settings.json（T1 设计 §2.2）
const KEY = 'imgbedUploader.credential';

let secretStorage: vscode.SecretStorage | undefined;

export function initSecrets(secrets: vscode.SecretStorage): void {
  secretStorage = secrets;
}

function store(): vscode.SecretStorage {
  if (secretStorage === undefined) {
    throw new Error('SecretStorage 尚未初始化');
  }
  return secretStorage;
}

// 凭据原样写入，不做 trim（凭据可能含首尾空格字符）
export async function setCredential(secret: string): Promise<void> {
  await store().store(KEY, secret);
}

export async function getCredential(): Promise<string | undefined> {
  return store().get(KEY);
}

export async function hasCredential(): Promise<boolean> {
  return (await getCredential()) !== undefined;
}

export async function clearCredential(): Promise<void> {
  await store().delete(KEY);
}
