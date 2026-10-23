# 发布清单（GitHub → npm → 插件市场）

这个目录已经是一份可以直接 `git init` 的仓库。下面按顺序做完即可。

## 当前版本：1.18.0

相对已发布的 1.0.0，这一版新增了顶栏整进程重启（确认框 + 忙时守卫 + 进度层）和会话迁移的未解析文件预览/合并。完整说明见 `CHANGELOG.md`，GitHub Release 正文可直接抄 `## 1.18.0` 那一节。

发版三步：改 `package.json` 的 `version` → `npm publish` → 打 `v1.18.0` tag 建 Release。

## 0. 占位符已填好

作者名和仓库地址都已替换成 `dream-fish69`：`package.json` 的 `author` / `repository` / `homepage` / `bugs`，`README.md` 与 `README.zh.md` 的安装命令，以及 `LICENSE` 的版权行。

以后要换账号或换仓库名，用下面这条批量替换（注意 `Set-Content -Encoding utf8` 在 PowerShell 5.1 会写 BOM，敏感场景改用 `[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))`）：

```powershell
cd dsh-session-workspace-organizer
(Get-ChildItem -Recurse -File -Include *.json,*.md,LICENSE |
  ForEach-Object { (Get-Content -Raw -Encoding UTF8 $_.FullName) -replace 'dream-fish69','新用户名' |
  Set-Content -NoNewline -Encoding utf8 $_.FullName })
```

## 1. 建仓库并推送

```powershell
cd dsh-session-workspace-organizer
git init -b main
git add .
git commit -m "feat: workspace relocation and per-session output folders"
git remote add origin https://github.com/dream-fish69/dsh-session-workspace-organizer.git
git push -u origin main
```

仓库名建议就用 `dsh-session-workspace-organizer`（与包名一致，索引里的 `url` 和 `name` 都省事）。

> 本机 PATH 上目前没有 `git`。三个替代办法：
> - 装 [Git for Windows](https://git-scm.com/download/win) 后按上面命令走；
> - 用 [GitHub Desktop](https://desktop.github.com/)：New repository → 指向这个目录 → Publish；
> - 纯网页：GitHub 建空仓库 → **Add file → Upload files**，把整个文件夹拖进去（会保留 `lib\`、`locale\`、`.github\workflows\` 的子目录结构）。

## 2. 填仓库简介和 topic

仓库页右上 ⚙ **About** → **Description**（350 字符以内）填：

```
Move a DeepSeek Harness workspace folder to a new path — session logs' cwd is rewritten too — and give every new session its own output folder under sessions/.
```

备选（更短）：`DeepSeek Harness plugin: relocate workspace folders and give every new session its own output folder.`

**Topics**（逗号分隔，逐个加）：

```
dsh-plugin, deepseek-harness, dsh, cordis, workspace, session-management, plugin
```

其中 `dsh-plugin` 是官方 README 提到的发现途径，必加。

## 3. 发 npm（可选，但推荐）

市场按 npm 的下载量排序，且预构建安装免掉 `allowBuilds` 构建授权。

**方式 A：本地首发**

```powershell
npm login
npm publish --access public
```

**方式 B：GitHub Actions + Trusted Publishing（首发之后推荐）**

1. 先用方式 A 发一次 1.0.0（新包必须 bootstrap 一次）；
2. npm 包页 → Settings → Publishing access → Trusted Publisher → GitHub Actions，填：
   - Organization or user：`dream-fish69`
   - Repository：`dsh-session-workspace-organizer`
   - Workflow filename：`publish.yml`
   - Environment：留空
3. 之后每次发版：改 `package.json` 的 `version` → commit → `git tag v1.0.1` → `git push origin v1.0.1`，workflow 会校验 tag 与版本一致后自动发布，并附上 provenance 证明。

> 坑：npm 自 2026-07-31 起，勾了 "Bypass 2FA" 的 Granular Access Token 只能发暂存区，直接 `npm publish` 会报 `E403 E_STAGE_REQUIRED`。别在仓库里配 `NPM_TOKEN`，交给 OIDC 即可。

## 4. 提交到插件市场索引

市场索引是社区的 awesome-dsh-plugin 项目（`dsh-plugin-catalog` 就是它发布的 JSON）。给它提一个 PR，**只加一个文件**：

路径：`data/plugins/dream-fish69__dsh-session-workspace-organizer.yml`

```yaml
url: https://github.com/dream-fish69/dsh-session-workspace-organizer
name: dream-fish69/dsh-session-workspace-organizer
category: session
description:
  en: Moves a DSH workspace folder to a new path and gives every new session its own output folder under sessions/.
  zh: 迁移 DSH 工作区文件夹的位置，并为每个新会话在 sessions/ 下建立独立输出目录。
```

规则（来自 contributing.md）：

- 一个 PR 最多 3 条；不要手改 README（生成物）。
- `description.en` 必填，中文可留空由维护者补；描述必须与代码一致，评审会逐条核对。
- 仓库必须满 1 天、有真实代码、`package.json` 声明 `dsh.bundle`（本仓库已有 ✅）。
- 分类：`session` 最贴切；也可考虑 `workflow`，维护者会改，不会因此打回。

合并后网站与 `dsh-plugin-catalog` 每天重建，市场里 1 天内可见。

## 5. 本地验证安装形态

推送前先确认装得上：

```powershell
dsh plugin --profile web add link:"D:\study\DSH-WORKSPEACE\releted to plugins\dsh-session-workspace-organizer"
```

装完重启 DSH，刷新页面，**设置 → 工作区** 应出现；卸载用 `dsh plugin --profile web remove dsh-session-workspace-organizer`。

## 附：关于包名

本项目统一使用 **`dsh-session-workspace-organizer`**。

`dsh-workspace-organizer` 是 npm 上另一个插件（Wang993，会话标签 + 归档），与本项目源码无关，也不是本项目的旧版本或别名。源码包名、`cordis.patch.yml`、`client.js` 的 `id`、`index.js` 的包名引用、README、安装命令、npm 包和 GitHub 仓库都使用 **`dsh-session-workspace-organizer`**，不要再改回旧名。
