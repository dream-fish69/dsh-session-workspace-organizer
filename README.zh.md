# dsh-session-workspace-organizer

[![npm version](https://img.shields.io/npm/v/dsh-session-workspace-organizer.svg)](https://www.npmjs.com/package/dsh-session-workspace-organizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：把工作区文件夹迁移到新位置，并让每个新会话在 `sessions/` 下拥有自己的输出目录。

[English](README.md) | 简体中文

DSH 把每个会话绑定到一个工作区目录，同一个工作区的所有会话共用这个目录——于是不同对话产生的脚本、日志、下载、截图全堆在一处。本插件在 DSH 自己的模型上补三件事，不修改 DSH 源码：

1. **迁移工作区**——把文件夹搬到别的路径或别的磁盘，会话跟着走：每个会话日志 header 里的 `cwd` 改写到新路径，会话照常可用，并继续归在新工作区下。
2. **每个会话一个输出目录**——新建或恢复会话时自动得到 `<工作区>/sessions/<YYYY-MM-DD>_<会话标题>/`；插件通过会话级系统提示告诉模型把新产物放这里；在**工作区根目录**新建文件时 `write` 会先弹确认。
3. **会话管理**——把未运行的会话移到别的工作区，或删除会话（带预览），可选连同它创建的文件一起删。

已在 **Windows + DSH Desktop 0.2.1-rc.2** 上验证。Host 端只用 Node 内置模块，客户端是手写的 CommonJS bundle，**没有构建步骤**。

---

## 安装

```sh
# 从 npm（预构建，无需构建授权）
dsh plugin --profile web add dsh-session-workspace-organizer

# 从 GitHub 源码
dsh plugin --profile web add github:dream-fish69/dsh-session-workspace-organizer

# 本地开发目录
dsh plugin --profile web add link:/绝对路径
```

**桌面端**：在侧栏「插件」页移除旧条目，再输入包名或 `github:dream-fish69/dsh-session-workspace-organizer` 安装。安装或升级后要**重启 DSH**——Host 半边只在启动时加载。

卸载：

```sh
dsh plugin --profile web remove dsh-session-workspace-organizer
```

卸载不会动 `sessions/` 里的目录和文件。

## 界面在哪

**设置 → 工作区**（英文界面为 Settings → Workspaces）。

### 移动位置

选择任意已注册工作区，点「移动位置…」，选择目标父文件夹并填写新文件夹名。插件执行**严格迁移**：

- 整个目录（含 `sessions/`）移到新路径，**旧路径被删除**，不保留 junction / 符号链接；
- 所有 header `cwd` 等于旧路径的会话日志都会被改写：zstd 第一帧是 header，只替换其中的 `cwd`，后续事件帧逐字节保留；随后把日志目录从 `--旧cwd--` 搬到 `--新cwd--`；
- 用新路径重建工作区注册并挂回会话；当前进程因缓存挂不上的会话写入 `pending-attach.json`，重启 DSH 后由插件自动归位；
- 跨磁盘移动先复制并逐文件校验，校验通过前不动源目录，失败自动回滚；
- 旧目录被占用（Windows `EBUSY`/`EPERM`/`EACCES`，例如 DSH 自己还持有句柄）时自动降级为**复制迁移**：复制并校验、改写副本日志、切换注册表，旧目录能删就删，删不掉会给出具体原因。

**硬性前提**：要移动的工作区不能有运行中的会话——会话日志是追加写的，运行中的写句柄不能安全改写。请**先切到另一个工作区的会话**再执行移动。若仍有会话在跑，弹窗会列出它们（标题 + id），可选「是」：先取消这些会话正在进行的任务、等它们停稳，再按复制方式处理并继续；但**承载这次操作的会话本身**若就在目标工作区，只能换地方操作。

如果旧路径正是 DSH 的启动目录，插件会临时切换进程工作目录和沙箱回退根，但桌面快捷方式/启动项仍需你手动改成新路径。

### 整理结构

只在缺失时创建 `sessions/` 和 `sessions/README.md`。勾选「同时移动散件」后，根目录的普通文件会移进 `sessions/<日期>_整理/`；点开头的隐藏文件、`README.md`、`AGENTS.md` 和常见项目清单保持不动。

### 会话

- **移动到工作区…**——把未运行的会话（单个或批量）移到另一个工作区：会话日志、它的 `sessions/` 专属目录及其中全部文件、以及它通过 `write`/`edit` 在 `sessions/` 之外写进源工作区的文件都会一起移动。
- **无法确定去向的文件（单个移动）**——移动前点「预览无法确定去向的文件」：计划会列出没有 marker 的历史会话目录、相对路径文件（写入时 cwd 不确定）、源工作区外文件、目标同名冲突，以及可选的项目目录。每条选择 **目标会话目录**、**目标工作区根目录**、**自定义目录…** 或 **取消迁移此条**（默认）。已知文件自动迁移，取消的留在原位置。
- **历史目录/项目**——可选填「旧会话文件夹」「项目目录」明确合并/移动。冲突文件不覆盖目标，保留为 `<文件名>.<旧目录名><扩展名>`，例如 `verify.COT中文翻译插件.md`。
- **删除**——永久删除未运行的会话，删除前有**预览**，列出将被删除的日志、会话目录和外部文件。只有勾选「同时删除它写过的文件」时才删除 `sessions/` 之外的文件，且只处理该会话源工作区内的文件。
- 批量移动仍按已知去向执行；无法确定去向的条目会报告并留在原位置。需要逐条选择去向时用单个移动。

## 每个会话一个目录

只要新会话或恢复的会话其 `cwd` 属于某个已注册工作区：

- 创建 `<工作区>/sessions/<YYYY-MM-DD>_<标题>/`；会话标题变化时目录自动改名（保留日期前缀，重名加 `-2`）；
- 目录里的 `.dsh-session` 记录 `sessionId`、`workspacePath`、`createdAt`，用于恢复会话时找回原目录，**请勿删除**；
- 该会话的作用域系统提示会告知模型：本会话新建的脚本、日志、下载、截图、临时数据、一次性产物都放这个目录，已有项目代码在原位置修改；
- 在**工作区根目录**用 `write` 新建文件会弹确认；已存在的文件与常见清单（`README.md`、`AGENTS.md`、`package.json`、各类 lockfile、`Makefile`、`Dockerfile` 等）不拦。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id 覆盖：

```yaml
- id: workspace-organizer
  config:
    sessionFolders: true      # 是否自动创建会话输出目录
    guardRootWrites: true     # 根目录新建文件时是否弹确认
    sessionsDirName: sessions # 会话目录的父目录名
    maxTitleChars: 40         # 目录名里标题的最大字符数（8-80）
    # sessionsRoot: /path/to/dsh/home/sessions   # 仅当 DSH 把日志放在别处
```

## 安全说明

- 严格迁移**会删除旧目录**。它只在预检通过后执行，先写新位置、再改写日志、最后删旧路径，任一步失败会回滚——但设计上没有“两边都留”的模式。想保留旧目录时请用复制迁移（插件自动降级的那条路）。
- 改写会话日志属于**离线**操作，迁移后请重启 DSH，让会话列表、搜索索引和持久化缓存重新读取新路径。
- 工作区内存在符号链接/联接点时，复制迁移会被拒绝（避免复制出循环或丢链接）；同磁盘重命名不受影响。
- 插件安装前就已打开、之后没有重新恢复的会话不会补建目录，下次恢复时才补。
- 所有破坏性命令都要求 check / preview 步骤签发的一次性确认令牌，客户端无法发出“裸删除”。

## 兼容性与限制

- DSH `0.2.x`，需要包含 `dsh-base` + `dsh-web-app` 的 Web 或 Desktop profile。
- 占用判断基于 Windows 错误码；其他平台上复制迁移就是常规路径。
- 移动与删除都以命令形式记录在一个打开的会话里，因此必须有会话打开，且该会话不能属于要移动的工作区。
- DSH 侧边栏工作区行的「…」菜单没有扩展槽位，所以入口放在设置里。

## 实现结构

| 层 | 文件 | 负责 |
| --- | --- | --- |
| Host | `index.js` | 注册 `workspace-relocate-check` / `workspace-relocate-strict` / `workspace-organize` / `session-relocate` / `session-relocate-batch` / `session-delete-preview` / `session-delete` / `session-delete-batch`；`agent/created` 建会话目录与作用域提示；`session/event` 跟随标题改名；`tools/pre-execute` 拦截根目录写入 |
| Host | `lib/fs-ops.js` | 目录移动（同盘 rename / 跨盘复制 + 校验 + 回滚）、名称净化、散件扫描 |
| Host | `lib/session-logs.js` | 解析 zstd 第一帧 header，只改写 `cwd`，后续帧原样保留；会话日志目录重定位 |
| Client | `client.js` | `settings.section` 页面：移动 / 整理 / 会话三个面板，文案取自 `locale/*.json` |

## 开发

```sh
npm run check   # node --check index.js、client.js、lib/fs-ops.js、lib/session-logs.js
```

没有打包器：`lib/` 就是源码，`client.js` 是 DSH 通过 `window.__ModuleLoader__` 加载的 bundle。改 Host 需要重启 DSH，改客户端刷新页面即可。

## License

MIT
