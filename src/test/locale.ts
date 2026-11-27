import * as vscode from 'vscode';

// T12 §5-S4：双语预期文案对照表按测试实例 locale 选择（test:zh 走 zh-cn）。
// 禁止用 vscode.l10n.t 取期望值：漏键时两边一起回落英文，同义反复。
export const zhCn: boolean = vscode.env.language === 'zh-cn';
