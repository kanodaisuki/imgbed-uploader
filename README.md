# ImgBed Uploader

[简体中文](#imgbed-uploader) | [English](#english)

一键上传 Markdown / MDX 文档里的图像到自托管的 [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 图床。具备粘贴截图自动上传，远程图转存，自定义 CDN 回写。

## 功能

- **一键上传**：上传文档内全部本地图像（或仅选定部分）并回写图床链接；相对路径按文档所在目录解析，同路径只传一次
  ![](https://image.kanochan.net/picx/Lkx9B27g.gif)

  ![](https://image.kanochan.net/picx/FnwFrljI.gif)

- **粘贴上传**：粘贴截图自动上传并插入链接；上传失败也不丢图（按 VS Code 默认行为保存到工作区）
  ![](https://image.kanochan.net/picx/Jl0eS6Ll.gif)

- **文件上传**：从文件选择框或资源管理器右键上传本地图片
  ![](https://image.kanochan.net/picx/G9qbhuw2.gif)

- **远程图像转存**：开启后把文档中的远程图片下载转存到你的图床；白名单域名保持不动
  ![](https://image.kanochan.net/picx/cG0WsqMN.gif)

- **自定义 CDN 回写**：配置 `customCdn` 后按「CDN + 文件 ID」优先生成链接
- **省心的批量语义**：重复执行自动跳过已回写链接；部分失败时成功的照常回写、失败的保留原链接并列出原因，一键「重试失败项」；全部替换后一次 Ctrl+Z 完整撤销
- **测试连接**：1x1 测试 PNG 端到端验证地址 + 凭据 + 渠道，配错早发现

## 快速开始

设置面板中输入`@ext:KanoChan.imgbed-uploader`打开插件设置。

1. 在设置中填入图床地址 `imgbedUploader.serverUrl`（如 `https://img.example.com`）
2. `ctrl` + `shift` + `p` 打开命令面板运行 **「ImgBed Uploader: 设置认证信息」**，录入上传认证码或 API Token（您的凭据在 VS Code SecretStorage 中被安全存储，不进配置文件）
3. 运行 **「ImgBed Uploader: 测试连接」** 验证连通性
4. 打开 Markdown / MDX 文档，右键 → **「上传文档全部本地图像」**，或点编辑器标题栏的云上传按钮

## 命令与入口

| 命令                 | 入口                                             | 说明                          |
| -------------------- | ------------------------------------------------ | ----------------------------- |
| 上传文档全部本地图像 | 编辑器右键菜单、编辑器标题栏按钮、命令面板       | 上传文档内全部本地图像并回写  |
| 上传选定图片         | 编辑器右键菜单（有选区时）、命令面板             | 只处理选区内的图像引用        |
| 上传本地图片         | 命令面板（弹文件选择框）、资源管理器右键图片文件 | 上传后在光标处插入链接        |
| 设置认证信息         | 命令面板                                         | 录入 / 更新认证码或 API Token |
| 测试连接             | 命令面板                                         | 端到端验证图床配置            |

粘贴上传不设命令：`pasteUpload` 开启时，直接在 Markdown / MDX 文档中 Ctrl+V 粘贴图片即可。

## 配置

| 设置项                              | 默认       | 说明                                                              |
| ----------------------------------- | ---------- | ----------------------------------------------------------------- |
| `imgbedUploader.serverUrl`          | 空         | 图床站点基础地址，如 `https://img.example.com`                    |
| `imgbedUploader.authType`           | `authCode` | 认证方式：上传认证码 / API Token / 免认证                         |
| `imgbedUploader.uploadChannel`      | `telegram` | 上传渠道（telegram / cfr2 / s3 / discord / huggingface / webdav） |
| `imgbedUploader.channelName`        | 空         | 同类型多渠道时指定渠道名，留空用服务端默认                        |
| `imgbedUploader.uploadFolder`       | 空         | 上传目录（相对路径，如 `img/test`），留空为根目录                 |
| `imgbedUploader.uploadNameType`     | `default`  | 文件命名：前缀_原名 / 仅前缀 / 仅原名 / 短链接                    |
| `imgbedUploader.expire`             | 空         | 文件有效期（如 `12h`、`7d`、`forever`），视服务端配置生效         |
| `imgbedUploader.serverCompress`     | 开         | 服务端压缩（仅 Telegram 渠道图片生效）                            |
| `imgbedUploader.autoRetry`          | 开         | 上传失败时自动切换渠道重试                                        |
| `imgbedUploader.customCdn`          | 空         | 自定义 CDN / URL 前缀，回写链接用它拼接文件 ID；可省略 `https://` |
| `imgbedUploader.uploadRemoteImages` | 关         | 一键上传时把非白名单远程图转存到图床                              |
| `imgbedUploader.remoteWhitelist`    | 空         | 远程图域名白名单（hostname 精确匹配），命中则不动                 |
| `imgbedUploader.pasteUpload`        | 开         | 粘贴图片自动上传并插入链接；关闭走 VS Code 默认行为               |

## 行为说明

- 代码块（围栏 / 行内 / 缩进）内的图像引用不处理，您的文本不会被误修改
- `./img/a.png`、`img/a.png`、`%20` 编码路径等写法均按文档所在目录解析
- 未保存的 untitled 文档里相对路径无法解析：进入失败报告并提示先保存
- 上传被服务端拒绝（如格式限制）时，服务端错误信息原样呈现
- 上传进行中重复触发命令会提示并忽略，不会并发两批任务

## 隐私与安全

- 凭据仅存于 VS Code SecretStorage，不写入 `settings.json`，随文档或仓库外泄
- 受限模式（未信任工作区）下只读取用户级设置：`serverUrl`、`customCdn`、渠道、目录、有效期等 9 项设置的工作区值会被忽略，避免不可信仓库把图片发往第三方服务器
- 远程图像转存的下载请求不携带 Authorization / Cookie / Referer 等凭据，User-Agent 为 `ImgBed-Uploader`
- 无遥测、无数据收集；除图床上传与远程图下载外无任何网络请求

## 系统要求

- VS Code `1.146.0` 及以上
- Markdown / MDX 文档
- 服务端为 CloudFlare ImgBed **v2.7.8**（本插件基于该版本开发，依赖 `responseFormat` 等接口）；其它版本未做完整测试，不保证兼容（欢迎提供测试报告！）

## 开发

```bash
pnpm install          # 安装依赖
pnpm run watch        # 监听编译（esbuild + tsc）
pnpm run compile      # 类型检查 + lint + 构建
pnpm run test         # 运行测试（首次需下载 VS Code 测试实例）
pnpm run vsix         # 生产构建并打包 .vsix
```

## License

MIT

---

# English

# ImgBed Uploader

One-click upload of images in Markdown / MDX documents to a self-hosted [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) image host. Features paste-screenshot auto upload, remote image re-hosting, and custom CDN link rewriting.

## Features

- **One-click upload**: upload all local images in a document (or just the selected ones) and write back the image host links; relative paths are resolved against the document's directory, and the same path is uploaded only once
  ![](https://image.kanochan.net/picx/Lkx9B27g.gif)

  ![](https://image.kanochan.net/picx/FnwFrljI.gif)

- **Paste upload**: pasting a screenshot automatically uploads it and inserts the link; a failed upload never loses your image (it is saved to the workspace per VS Code's default behavior)
  ![](https://image.kanochan.net/picx/Jl0eS6Ll.gif)

- **File upload**: upload local images from a file picker or via right-click in the Explorer
  ![](https://image.kanochan.net/picx/G9qbhuw2.gif)

- **Remote image re-hosting**: when enabled, remote images in the document are downloaded and re-hosted on your image host; whitelisted domains are left untouched
  ![](https://image.kanochan.net/picx/cG0WsqMN.gif)

- **Custom CDN link rewriting**: with `customCdn` configured, links are generated as "CDN + file ID" first
- **Worry-free batch semantics**: re-running automatically skips already rewritten links; on partial failure, successes are written back as usual while failures keep their original links with the reasons listed, plus a one-click "Retry failed items"; after a full replacement a single Ctrl+Z undoes everything
- **Test connection**: end-to-end verification of URL + credentials + channel with a 1x1 test PNG, so misconfiguration shows up early

## Quick Start

Open the extension settings by typing `@ext:KanoChan.imgbed-uploader` in the Settings panel.

1. Fill in the image host base URL `imgbedUploader.serverUrl` (e.g. `https://img.example.com`) in the settings
2. Press `ctrl` + `shift` + `p` to open the Command Palette and run **"ImgBed Uploader: 设置认证信息" (Set Credentials)** to enter the upload auth code or API Token (your credentials are stored securely in VS Code SecretStorage, never in configuration files)
3. Run **"ImgBed Uploader: 测试连接" (Test Connection)** to verify connectivity
4. Open a Markdown / MDX document, right-click → **"上传文档全部本地图像" (Upload All Local Images in Document)**, or click the cloud upload button in the editor title bar

## Commands & Entry Points

| Command                                                    | Entry                                                                       | Description                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 上传文档全部本地图像 (Upload All Local Images in Document) | Editor context menu, editor title bar button, Command Palette               | Upload all local images in the document and write back the links |
| 上传选定图片 (Upload Selected Images)                      | Editor context menu (when there is a selection), Command Palette            | Only process image references within the selection               |
| 上传本地图片 (Upload Local Image)                          | Command Palette (opens a file picker), Explorer context menu on image files | Insert the link at the cursor after uploading                    |
| 设置认证信息 (Set Credentials)                             | Command Palette                                                             | Enter / update the auth code or API Token                        |
| 测试连接 (Test Connection)                                 | Command Palette                                                             | End-to-end verification of the image host configuration          |

Paste upload has no command: with `pasteUpload` enabled, just press Ctrl+V to paste an image into a Markdown / MDX document.

## Configuration

| Setting                             | Default    | Description                                                                                         |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `imgbedUploader.serverUrl`          | (empty)    | Base URL of the image host site, e.g. `https://img.example.com`                                     |
| `imgbedUploader.authType`           | `authCode` | Authentication method: upload auth code / API Token / no auth                                       |
| `imgbedUploader.uploadChannel`      | `telegram` | Upload channel (telegram / cfr2 / s3 / discord / huggingface / webdav)                              |
| `imgbedUploader.channelName`        | (empty)    | Channel name when there are multiple channels of the same type; leave empty for the server default  |
| `imgbedUploader.uploadFolder`       | (empty)    | Upload folder (relative path, e.g. `img/test`); leave empty for the root                            |
| `imgbedUploader.uploadNameType`     | `default`  | File naming: prefix_original name / prefix only / original name only / short link                   |
| `imgbedUploader.expire`             | (empty)    | File expiration (e.g. `12h`, `7d`, `forever`), subject to server configuration                      |
| `imgbedUploader.serverCompress`     | On         | Server-side compression (only applies to images on the Telegram channel)                            |
| `imgbedUploader.autoRetry`          | On         | Automatically switch channels and retry on upload failure                                           |
| `imgbedUploader.customCdn`          | (empty)    | Custom CDN / URL prefix used to build rewritten links from the file ID; `https://` may be omitted   |
| `imgbedUploader.uploadRemoteImages` | Off        | Re-host non-whitelisted remote images to the image host on one-click upload                         |
| `imgbedUploader.remoteWhitelist`    | (empty)    | Remote image domain whitelist (exact hostname match); matching URLs are left untouched              |
| `imgbedUploader.pasteUpload`        | On         | Pasting an image auto-uploads it and inserts the link; when off, VS Code's default behavior applies |

## Behavior Notes

- Image references inside code blocks (fenced / inline / indented) are not processed; your text is never modified by mistake
- `./img/a.png`, `img/a.png`, `%20`-encoded paths and similar forms are all resolved against the document's directory
- Relative paths in unsaved untitled documents cannot be resolved: they go into the failure report with a prompt to save first
- When an upload is rejected by the server (e.g. format restrictions), the server's error message is shown as-is
- Triggering the command again while an upload is in progress shows a notice and is ignored; two batches never run concurrently

## Privacy & Security

- Credentials are stored only in VS Code SecretStorage, never written to `settings.json`, so they cannot leak with documents or repositories
- In Restricted Mode (untrusted workspaces) only user-level settings are read: workspace values of 9 settings — `serverUrl`, `customCdn`, channel, folder, expiration, etc. — are ignored, so an untrusted repository cannot send your images to a third-party server
- Remote image re-hosting download requests carry no Authorization / Cookie / Referer credentials; the User-Agent is `ImgBed-Uploader`
- No telemetry, no data collection; no network requests other than image host uploads and remote image downloads

## Requirements

- VS Code `1.146.0` or later
- Markdown / MDX documents
- A CloudFlare ImgBed server at **v2.7.8** (this extension is developed against that version and relies on interfaces such as `responseFormat`); other versions are not fully tested and compatibility is not guaranteed (test reports welcome!)

## Development

```bash
pnpm install          # Install dependencies
pnpm run watch        # Watch build (esbuild + tsc)
pnpm run compile      # Type check + lint + build
pnpm run test         # Run tests (the VS Code test instance is downloaded on first run)
pnpm run vsix         # Production build and package the .vsix
```

## License

MIT
