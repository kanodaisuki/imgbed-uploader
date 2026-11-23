# Changelog

本文件记录 ImgBed Uploader 的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 安全

- 声明 `capabilities.untrustedWorkspaces`：受限模式（未信任工作区）下，上传地址、渠道、目录、有效期等 9 项设置只读取用户级值，避免不可信仓库把图片发往第三方服务器

## [1.0.0] - 2026-11-20

首个正式版，面向 CloudFlare ImgBed v2.7.8 开发。

### 新增

- **一键上传**：上传 Markdown / MDX 文档中的全部本地图像（或仅选定部分）并回写图床链接；相对路径按文档所在目录解析（含 `%20` 编码路径），同路径只上传一次、多处回写同一链接
- **粘贴上传**：粘贴截图自动上传并插入链接，光标停在链接后；上传失败不丢图，按 VS Code 默认行为保存到工作区
- **文件上传**：文件选择框 / 资源管理器右键上传本地图片，插入光标处（每文件独立一行，单次编辑、一次 Ctrl+Z 完整撤销）
- **远程图像转存**：开启后把非白名单远程图下载转存到图床（下载请求不携带凭据），白名单域名保持原样
- **自定义 CDN 回写**：配置 `customCdn` 后按「CDN + 文件 ID」优先生成链接，无 scheme 自动补全 `https://`
- **部分失败报告与重试**：成功的照常回写、失败的保留原链接并原样呈现服务端原因，通知内一键「重试失败项」；上传进度条支持取消，已成功的不受影响
- **幂等**：重复执行自动跳过已回写链接，不改写文档中已有链接
- **测试连接**：1x1 测试 PNG 端到端验证地址 + 凭据 + 渠道，失败按情形给出可行动作（重新测试 / 设置认证信息 / 打开设置）
- **设置认证信息**：上传认证码 / API Token 存入 VS Code SecretStorage（不进配置文件），支持免认证模式
- **13 项设置**：渠道、渠道名、上传目录、命名方式、有效期、服务端压缩、自动重试、远程图白名单等，详见 README

### 已知限制

- 仅面向 CloudFlare ImgBed v2.7.8 开发，其它服务端版本未做完整测试
- 含空格的文件名回写后 URL 值含空格（Markdown 中由 `<>` 包装、链接可用；复制到别处使用时需自行百分号编码）
- 未保存的 untitled 文档中相对路径无法解析，该引用进入失败报告并提示先保存

[Unreleased]: https://github.com/kanodaisuki/imgbed-uploader/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kanodaisuki/imgbed-uploader/tree/v1.0.0
