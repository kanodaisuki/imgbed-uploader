import * as vscode from 'vscode';
import { type SkipReason } from './parse';

// T12 §4：按钮 label 常量。显示与点击分发共用同一常量，
// 翻译后文案变化不会导致比较不命中（按钮动作静默失效）。
// locale 会话内不变（T12 §2），模块加载期求值一次即可。
export const BTN = {
  openSettings: vscode.l10n.t('Open Settings'),
  setCredentials: vscode.l10n.t('Set Credentials'),
  resetCredentials: vscode.l10n.t('Update credentials'),
  retryFailed: vscode.l10n.t('Retry failed items'),
  copyLink: vscode.l10n.t('Copy link'),
  retest: vscode.l10n.t('Test again'),
} as const;

// T12 §2 补充裁决：parse.ts SkipReason code → 显示文本。
// parse 是纯函数模块不 import vscode，字面量集中在此过 l10n.t（提取工具自动抓取）。
export const REASON_TEXT: Record<SkipReason, string> = {
  unclosedAngleUrl: vscode.l10n.t('Unclosed angle-bracket URL'),
  illegalResidue: vscode.l10n.t('Illegal residue after URL'),
  unwrappedSpace: vscode.l10n.t(
    'URL contains un-wrapped spaces or illegal residue',
  ),
  protocolRelative: vscode.l10n.t(
    'Protocol-relative URLs are not supported yet',
  ),
  unparsableUrl: vscode.l10n.t('URL cannot be parsed'),
  emptySrcAttr: vscode.l10n.t('src attribute has no value'),
  unclosedParen: vscode.l10n.t('Unclosed parenthesis'),
};
