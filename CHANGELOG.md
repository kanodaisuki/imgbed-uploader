# Change Log

All notable changes to the "imgbed-uploader" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.0.0] - 2026-11-20

### 新增

- 一键上传：上传 Markdown / MDX 文档中的全部本地图像（或仅选定部分）并回写图床链接；相对路径按文档所在目录解析，同路径只传一次，重复执行自动跳过，一次 Ctrl+Z 完整撤销
- 粘贴上传：粘贴截图自动上传并插入链接；失败降级按 VS Code 默认行为保存到工作区，不丢图
- 文件上传：文件选择框 / 资源管理器右键上传本地图片，插入光标处
- 远程图像转存：开启后把非白名单远程图下载转存到图床（白名单域名保持不动）
- 自定义 CDN 回写：配置 `customCdn` 后按「CDN + 文件 ID」优先生成链接
- 部分失败汇总报告：失败原因逐项列出，可一键「重试失败项」；上传进度条支持取消
- 「测试连接」命令（1x1 测试 PNG 端到端验证）与「设置认证信息」命令；凭据存 SecretStorage，支持认证码 / API Token / 免认证
