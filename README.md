# ImgBed Uploader

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
