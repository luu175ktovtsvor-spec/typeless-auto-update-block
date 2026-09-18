# Typeless 2.7.0：客户端更新层与云端请求边界

<p align="center">
  <a href="../README.md">English README</a> &nbsp;·&nbsp;
  <a href="../README.zh-CN.md">中文说明</a> &nbsp;·&nbsp;
  <b>本文：中文</b>
</p>

> 对象：macOS Apple silicon 上的 `Typeless.app` 2.7.0，Bundle ID `now.typeless.desktop`。
> 本文是本地安装包的只读分析和运行记录，不是 Typeless 官方说明，也不代表后续版本。

## 结论先说

1. 更新配置可以被本项目改到本机 feed；本机验证过应用请求命中 `127.0.0.1`，关于页显示当前版本。
2. 这只改变更新清单的来源。语音、上下文、历史同步、账号策略和模型请求仍由 Typeless 自己处理。
3. 客户端代码能说明“它准备发送什么”和“它尝试连接哪里”，不能单独证明服务端保存多久、模型如何使用数据或策略最终如何执行。

## 1. 证据等级

| 标记 | 证据 | 能说明什么 |
| --- | --- | --- |
| A | 安装包内代码、配置和字符串 | 客户端实现了什么路径 |
| B | 本机进程、连接、日志和 UI | 这台机器在某个时间点实际发生了什么 |
| C | 基于 A/B 的解释 | 需要保留不确定性，不能写成事实 |

本文不把 C 级推断写成“服务端一定如何处理”。

## 2. 更新层

| 项目 | 当前观察 | 证据 |
| --- | --- | --- |
| 更新库 | `electron-updater` 6.6.2 | A |
| 配置 | `provider: generic`、`channel: arm64`、`url: https://typeless-static.com/desktop-release/`（原始安装包值） | A |
| 清单 | `arm64-mac.yml` | A |
| 缓存 | `~/Library/Caches/typeless-updater/`，可能包含 `pending/` | A/B |
| 版本 | `Info.plist` 中的 2.7.0 | B |

本项目的变更只有：

```text
https://typeless-static.com/desktop-release/
    ↓
http://127.0.0.1:<port>/now.typeless.desktop/
```

本地服务读取当前安装版本，生成同版本的清单。版本相同是 electron-updater 判定不需要更新的输入；这不等于对其他网络请求做了拦截。

### 关于“自改写”

静态分析记录显示，客户端可能根据 CPU 架构调整 channel。这个行为会让更新配置发生漂移，因此守护进程提供了 20 秒对账和 `repair`。对账存在时间窗口，不能表述成绝对实时或竞态免疫。

### 关于错误和遥测

更新失败事件在客户端代码中有记录路径。将 feed 指向本地并返回同版本清单，可以避免“远端 feed 不可达”这一类失败；不能据此保证应用不会发送其他错误、性能或业务埋点。

## 3. 云端请求边界

根据客户端代码中的请求路径和构造逻辑，Typeless 至少包含以下业务通道：

| 通道 | 代码中可见的用途 | 更新源控制器能否改变 |
| --- | --- | --- |
| `/ai/voice_flow` | 音频转写、命令、翻译或问答 | 不能 |
| `/transcription_history/*` | 历史记录同步和清理 | 不能 |
| `/user/traits` | 用户编辑结果相关回传 | 不能 |
| `/get_blacklist_domain`、`/app/get_blacklist_domain` | 黑名单或采集策略 | 不能 |
| Sentry / metrics | 错误、性能和事件 | 不能 |

### 一次语音请求的可见组成

客户端会把录音编码为 Ogg/Opus，并在请求中携带模式、时长、设备名等元数据。代码还构造了 `audio_context`，其中可能包含当前应用信息、窗口或页面信息、输入框前后文本、可见文本摘要和选中文本。

这些字段来自客户端构造代码，属于“准备发送”的证据。本文没有做 TLS 中间人，也没有解码线上报文，因此不把它们写成“服务端最终收到并保存了全部字段”。

### 加密边界

代码中可见 RSA 公钥获取、AES-GCM 内容加密和请求签名相关逻辑。公钥由服务端提供，客户端加密并不等于本机拥有服务端的留存或模型使用控制权。

## 4. 本地留存和外发的区分

| 数据 | 位置或目的地 | 是否受本工具影响 |
| --- | --- | --- |
| 更新清单请求 | 本机 `127.0.0.1` | 是 |
| 录音和本地历史 | Typeless 的 Application Support 目录 | 不直接影响 |
| 音频、上下文、模式参数 | Typeless 业务 API | 不影响 |
| 历史同步 | `/transcription_history/*` | 不影响 |
| 编辑结果回传 | `/user/traits` | 不影响 |
| 错误和事件 | Sentry / metrics | 不影响 |

因此，“冻结更新”不等于“冻结数据流”。如果目标是让音频不离开本机，需要另行采用本地转写链路；这不是本仓库提供的能力。

## 5. 可以确认和不能确认的事情

### 可以确认

- 当前安装包的更新配置是否已经指向本地 feed。
- 本地守护进程是否收到清单请求，并返回哪个版本。
- 应用更新缓存中是否存在 `pending/` 文件。
- 客户端代码中出现的请求路径、字段构造和策略字段。

### 不能仅凭客户端确认

- 服务端实际保存时长、训练用途或人工访问权限。
- 服务端实时使用的模型版本和提示词。
- 账号套餐、配额、组织策略和最低客户端版本是否改变。
- 后续 Typeless 版本是否继续使用相同协议。
- `desktopCapturer` 出现是否意味着屏幕像素一定被上传。

## 6. 可复现的只读检查

```sh
# 更新配置
cat /Applications/Typeless.app/Contents/Resources/app-update.yml

# 本地控制器状态
node src/cli.mjs status
node src/cli.mjs doctor

# 业务域名和路径（只读字符串搜索）
cd /Applications/Typeless.app/Contents/Resources
rg -a -o "api\\.typeless\\.com|/ai/voice_flow|/user/traits|/transcription_history/push|rsa:get-config" app.asar | sort -u

# 当前连接（只读）
lsof -n -P -i | grep -i typeless

# 本地留存目录（只读）
ls -la "$HOME/Library/Application Support/Typeless"
```

这些命令只能复现本机当前状态；它们不能代替服务端审计或跨版本测试。

## 7. 方法和限制

- 解析安装包时不执行其中的业务代码。
- 本地运行观测受当前账号、权限、网络、登录状态和应用版本影响。
- 混淆代码里的算法细节可能无法完全恢复；只记录已定位到的输入和调用关系。
- 没有 TLS 中间人，因此没有声称解码过真实上传报文。
- Windows、Sparkle 和后续 Typeless 版本不在本文的真实验证范围内。
