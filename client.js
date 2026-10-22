window.__ModuleLoader__.load({
  id: 'dsh-session-workspace-organizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'workspaceOrganizer'

    const MESSAGES = {
      en: {
        section: 'Workspaces',
        title: 'Workspace manager',
        intro: 'Move a workspace folder and give every new session its own output directory.',
        sessionFoldersNote: 'Each new session automatically gets a sessions/<date>_<title>/ folder, and the model is told to put new artifacts there. Moving a workspace moves these folders too.',
        junctionNote: 'Strict mode deletes the old path: session-log cwd values are rewritten to the new path and the old folder is not kept. The target workspace must have no running session.',
        noSession: 'Open a conversation first: these operations run as a command recorded in that session. That session must be in a different workspace from the one being moved.',
        listEmpty: 'No workspaces are registered yet.',
        sessionsCount: '{n} sessions',
        'sessions.title': 'Session workspaces',
        'sessions.note': 'Move an inactive session to another workspace. The session log, its sessions/ folder with all files, and files the session wrote outside sessions/ (from write/edit records) move together. Same-name files already in the target are not overwritten and are listed. Shell-created files are not tracked. Restart DSH afterwards.',
        'sessions.empty': 'No sessions found.',
        'sessions.current': 'Current',
        'sessions.move': 'Move to workspace…',
        'sessions.workspace': 'Workspace',
        'sessionMove.title': 'Move session to another workspace',
        'sessionMove.target': 'Target workspace',
        'sessionMove.note': 'The target session must not be running. The session log header cwd is rewritten; the session’s sessions/ folder and files it wrote outside it (from write/edit records) are moved. Same-name target files are not overwritten. Restart DSH to refresh.',
        'sessionMove.confirm': 'Move session',
        'sessionMove.busy': 'Moving…',
        'sessionMove.done': 'Session moved.',
        'sessionMove.noTarget': 'No other workspace is available.',
        'sessions.selected': '{n} selected',
        'sessions.selectAll': 'Select all',
        'sessions.clear': 'Clear',
        'sessions.batchMove': 'Move selected…',
        'sessionBatch.title': 'Move sessions to a workspace',
        'sessionBatch.target': 'Target workspace',
        'sessionBatch.selectedList': 'Selected sessions',
        'sessionBatch.note': 'Only inactive sessions can move. The current session is not selectable; live sessions will be reported as failures. Each session’s log, its sessions/ folder, and files it wrote outside sessions/ move together; same-name target files are not overwritten. Restart DSH afterwards.',
        'sessionBatch.confirm': 'Move selected sessions',
        'sessionBatch.busy': 'Moving sessions…',
        'sessionBatch.done': 'Batch move completed.',
        'sessionBatch.noSelection': 'Select at least one session.',
        'sessions.delete': 'Delete session',
        'sessions.batchDelete': 'Delete selected…',
        'sessionDelete.title': 'Delete session',
        'sessionDelete.batchTitle': 'Delete sessions',
        'sessionDelete.note': 'This permanently deletes the session log and its sessions/ folder with all files. It cannot be undone. The target session must not be running.',
        'sessionDelete.written': 'Also delete files the session wrote outside sessions/ (from write/edit records)',
        'sessionDelete.writtenNote': 'This can delete project files the session created or edited. Only files under its source workspace are touched.',
        'sessionDelete.confirm': 'Delete permanently',
        'sessionDelete.busy': 'Deleting…',
        'sessionDelete.done': 'Session deleted.',
        'sessionDelete.previewing': 'Preparing delete preview…',
        'sessionDelete.preview': 'Delete preview',
        'sessionDelete.previewError': 'Could not prepare the delete preview.',
        'error.confirmMissing': 'The confirmation token is missing. Reopen the dialog and try again.',
        move: 'Move location…',
        organize: 'Organize',
        'move.title': 'Move workspace location',
        'move.current': 'Current path',
        'move.parent': 'Destination parent folder',
        'move.name': 'New folder name',
        'move.pick': 'Choose…',
        'move.picking': 'Choosing…',
        'move.target': 'New location: {path}',
        'move.note': 'Strict move: the whole folder moves, the old path is deleted (no junction), and every session-log cwd is rewritten. The target workspace must have no running session — switch to a session in another workspace first. Close terminals and running tasks. If the old path is DSH\'s launch directory, update the shortcut afterwards. Restart DSH after the move.',
        'move.confirm': 'Move workspace',
        'move.moving': 'Moving…',
        'move.done': 'Move completed.',
        'move.blockedTitle': 'Sessions are blocking the move',
        'move.blockedBody': 'These sessions still run in the target workspace. The move needs them stopped first:',
        'move.blockedQuestion': 'Force-stop these sessions and continue?',
        'move.blockedSelf': 'The session carrying this operation is inside the workspace being moved, so it cannot be force-stopped. Open a session in another workspace and move from there.',
        'move.forceYes': 'Yes',
        'move.forceNo': 'Cancel',
        cancel: 'Cancel',
        close: 'Close',
        'organize.title': 'Organize workspace structure',
        'organize.intro': 'Creates the sessions/ directory and its README under {path}. Existing files are left alone.',
        'organize.loose': 'Also move loose root files into sessions/<date>_整理/',
        'organize.looseNote': 'Only ordinary files directly at the workspace root are moved. Hidden dotfiles, README.md, AGENTS.md and common project manifests are skipped.',
        'organize.confirm': 'Organize',
        'organize.busy': 'Organizing…',
        'organize.done': 'Organize completed.',
        'error.parentEmpty': 'Enter a destination parent folder.',
        'error.nameEmpty': 'Enter a new folder name.',
        'error.nameSpaces': 'The folder name cannot start or end with a space.',
        'error.nameInvalid': 'The folder name contains invalid characters (<>:"/\\|?*).',
        'error.nameEnd': 'The folder name cannot end with a dot or space.',
        'error.nameReserved': 'That folder name is a reserved Windows name.',
        'error.noSession': 'No live session is available. Open a conversation and try again.',
        'error.noPicker': 'The directory picker is unavailable.',
        'error.unknownCommand': 'The command was not recognized. Restart DSH and try again.',
        'error.noResult': 'The operation returned no result.',
      },
      zh: {
        section: '工作区',
        title: '工作区管理',
        intro: '在这里迁移工作区文件夹的位置，并为每个新会话建立独立的输出目录。',
        sessionFoldersNote: '新会话会自动在 sessions/ 下创建“日期_标题”文件夹，并在系统提示中要求把新产物放进去；移动工作区时这些文件夹会一起移动。',
        junctionNote: '严格迁移会删除旧路径：会话日志里的 cwd 会被改写到新路径，旧目录不再保留。目标工作区必须没有运行中的会话；若旧目录被占用、无法重命名，会自动降级为复制迁移并保留旧目录。',
        noSession: '请先打开一个会话再执行这些操作：操作会以命令形式记录在该会话中，并且该会话不能在要移动的工作区里。',
        listEmpty: '还没有已注册的工作区。',
        sessionsCount: '{n} 个会话',
        'sessions.title': '会话归属',
        'sessions.note': '把未运行的会话移动到另一个工作区：会话日志、sessions/ 专属文件夹及其中所有文件、以及会话通过 write/edit 在 sessions/ 之外写到工作区的文件都会一起移动。目标已有同名文件时不覆盖，会列出冲突；shell 命令直接创建的文件不在记录里。完成后重启 DSH。',
        'sessions.empty': '没有找到会话。',
        'sessions.current': '当前',
        'sessions.move': '移动到工作区…',
        'sessions.workspace': '工作区',
        'sessionMove.title': '把会话移动到另一个工作区',
        'sessionMove.target': '目标工作区',
        'sessionMove.note': '目标会话必须处于未运行状态。移动会改写会话日志 header 的 cwd，并搬 sessions/ 专属文件夹及其中所有文件，以及会话通过 write/edit 写在 sessions/ 之外的文件；目标同名文件不覆盖。完成后重启 DSH 生效。',
        'sessionMove.confirm': '移动会话',
        'sessionMove.busy': '正在移动…',
        'sessionMove.done': '会话移动完成。',
        'sessionMove.noTarget': '没有其他工作区可移动。',
        'sessions.selected': '已选 {n} 个',
        'sessions.selectAll': '全选',
        'sessions.clear': '清空',
        'sessions.batchMove': '移动选中会话…',
        'sessionBatch.title': '把多个会话移动到工作区',
        'sessionBatch.target': '目标工作区',
        'sessionBatch.selectedList': '已选会话',
        'sessionBatch.note': '只有未运行的会话能移动；当前会话不可选，其他正在运行的会话会在结果里报失败。每条会话的日志、sessions/ 专属文件夹，以及它通过 write/edit 写在 sessions/ 之外的文件都会一起移动；目标同名文件不覆盖。完成后重启 DSH。',
        'sessionBatch.confirm': '移动选中会话',
        'sessionBatch.busy': '正在批量移动…',
        'sessionBatch.done': '批量移动完成。',
        'sessionBatch.noSelection': '请至少选择一个会话。',
        'sessions.delete': '删除会话',
        'sessions.batchDelete': '删除选中会话…',
        'sessionDelete.title': '删除会话',
        'sessionDelete.batchTitle': '删除多个会话',
        'sessionDelete.note': '会永久删除会话日志和该会话的 sessions/ 专属目录及其中所有文件，不能恢复。目标会话必须处于未运行状态。',
        'sessionDelete.written': '同时删除会话通过 write/edit 写在 sessions/ 之外的文件',
        'sessionDelete.writtenNote': '这可能会删掉会话创建或修改过的项目文件；只处理该会话源工作区内的文件。',
        'sessionDelete.confirm': '永久删除',
        'sessionDelete.busy': '正在删除…',
        'sessionDelete.done': '会话已删除。',
        'sessionDelete.previewing': '正在生成删除预览…',
        'sessionDelete.preview': '删除预览',
        'sessionDelete.previewError': '无法生成删除预览。',
        'error.confirmMissing': '缺少操作确认令牌，请重新打开对话框再试。',
        move: '移动位置…',
        organize: '整理结构',
        'move.title': '移动工作区位置',
        'move.current': '当前路径',
        'move.parent': '目标父文件夹',
        'move.name': '新文件夹名',
        'move.pick': '选择…',
        'move.picking': '选择中…',
        'move.target': '新位置：{path}',
        'move.note': '严格迁移：整个文件夹（包括 sessions/）搬到新路径，旧路径删除（不再保留 junction），并改写每个会话日志的 cwd。目标工作区必须没有运行中的会话——请先切换到另一个工作区的会话再操作；请关闭该工作区里的终端和正在运行的任务。若旧目录被进程占用、无法重命名，会自动降级为复制迁移：副本放到新位置，旧目录保留，重启 DSH 确认后由你手动删除。如果旧路径是 DSH 的启动目录，移动后请修改快捷方式。完成后重启 DSH。',
        'move.blockedTitle': '有会话正在阻止迁移',
        'move.blockedBody': '以下会话仍在目标工作区里运行，迁移前需要先停止它们：',
        'move.blockedQuestion': '是否强制停止这些会话并继续迁移？',
        'move.blockedSelf': '承载这次操作的会话本身就在要移动的工作区里，不能强制停止它。请在另一个工作区打开一个会话，再从那里执行移动。',
        'move.forceYes': '是',
        'move.forceNo': '取消',
        'move.confirm': '开始移动',
        'move.moving': '正在移动…',
        'move.done': '移动完成。',
        cancel: '取消',
        close: '关闭',
        'organize.title': '整理工作区结构',
        'organize.intro': '将在 {path} 下创建 sessions/ 目录和说明文件；已有文件不会被动。',
        'organize.loose': '同时把根目录中的散件文件移入 sessions/<日期>_整理/',
        'organize.looseNote': '只移动根目录下的普通文件；跳过 . 开头的隐藏文件、README.md、AGENTS.md 和常见项目清单。',
        'organize.confirm': '开始整理',
        'organize.busy': '正在整理…',
        'organize.done': '整理完成。',
        'error.parentEmpty': '请填写目标父文件夹。',
        'error.nameEmpty': '请填写新文件夹名。',
        'error.nameSpaces': '文件夹名不能以空格开头或结尾。',
        'error.nameInvalid': '文件夹名包含非法字符（<>:"/\\|?*）。',
        'error.nameEnd': '文件夹名不能以点或空格结尾。',
        'error.nameReserved': '文件夹名是 Windows 保留名。',
        'error.noSession': '没有可用的会话，无法执行命令。请先打开一个会话。',
        'error.noPicker': '目录选择器不可用。',
        'error.unknownCommand': '命令没有被识别，请重启 DSH 后再试。',
        'error.noResult': '操作没有返回结果。',
      },
    }

    const CSS = `
.wso-page{max-width:760px;padding:4px 2px 48px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.wso-page h2{margin:0 0 8px;font-size:18px;font-weight:600;line-height:26px}
.wso-intro{margin:0 0 10px;color:var(--dsw-alias-label-secondary)}
.wso-note{margin:0 0 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.wso-warn{margin:10px 0;padding:8px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.wso-empty{color:var(--dsw-alias-label-secondary);margin-top:16px}
.wso-list{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.wso-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.wso-main{flex:1;min-width:0}
.wso-title{font-size:14px;font-weight:600;line-height:20px}
.wso-path{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wso-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:2px}
.wso-row-actions{display:flex;gap:8px;flex:none;flex-wrap:wrap}
.wso-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.wso-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.wso-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wso-btn:disabled{opacity:.5;cursor:default}
.wso-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.wso-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:24px}
.wso-dialog{width:min(580px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:20px;box-shadow:0 24px 64px rgba(0,0,0,.28)}
.wso-dialog h3{margin:0 0 14px;font-size:16px;font-weight:600}
.wso-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.wso-field label,.wso-field span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.wso-inline{display:flex;gap:8px}
.wso-inline input{flex:1}
.wso-dialog input:not([type=checkbox]){height:34px;box-sizing:border-box;width:100%;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.wso-dialog input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0}
.wso-path-box{font-family:var(--dsh-font-mono,ui-monospace,monospace);font-size:12px;line-height:18px;word-break:break-all;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:6px 8px}
.wso-check{display:flex;gap:8px;align-items:flex-start;margin:12px 0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.wso-check input{margin-top:3px}
.wso-result{white-space:pre-wrap;word-break:break-word;margin:10px 0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;max-height:240px;overflow:auto}
.wso-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:8px 0;white-space:pre-wrap;word-break:break-word}
.wso-confirm{margin:12px 0;padding:12px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.wso-confirm-title{margin:0 0 6px;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-state-warn-primary)}
.wso-blockers{margin:6px 0 8px;padding-left:20px;font-size:12px;line-height:20px;word-break:break-all;max-height:180px;overflow:auto}
.wso-h3{margin:22px 0 6px;font-size:15px;font-weight:600;line-height:22px}
.wso-sessions{display:flex;flex-direction:column;gap:8px;margin-top:8px;max-height:360px;overflow:auto;padding-right:4px}
.wso-session{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.wso-session-main{flex:1;min-width:0}
.wso-session-title{font-size:13px;font-weight:600;line-height:20px;display:flex;align-items:center;gap:6px;min-width:0}
.wso-session-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wso-tag{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 6px;line-height:16px;flex:none}
.wso-select{height:34px;box-sizing:border-box;width:100%;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.wso-batch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding:8px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;flex-wrap:wrap}
.wso-batch-info{font-size:12px;color:var(--dsw-alias-label-secondary)}
.wso-check{width:16px;height:16px;flex:none;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.wso-check:disabled{cursor:not-allowed;opacity:.4}
.wso-batch-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto;margin:6px 0 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}
.wso-batch-item{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.wso-batch-item span{color:var(--dsw-alias-label-secondary)}
.wso-danger{color:#d92d20;border-color:#d92d20}
.wso-danger:hover{background:rgba(217,45,32,.08)}
.wso-delete-check{display:flex;gap:8px;align-items:flex-start;margin:8px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.wso-delete-check input{margin-top:2px;flex:none;accent-color:#d92d20}
.wso-delete-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0 0 8px 22px}
.wso-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
`

    function baseName (path) {
      const parts = String(path ?? '').split(/[\\/]+/).filter(Boolean)
      return parts.length === 0 ? '' : parts[parts.length - 1]
    }

    function dirName (path) {
      const text = String(path ?? '')
      if (/^[a-zA-Z]:[\\/]$/.test(text)) return text
      const index = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))
      if (index <= 0) return text
      if (index === 2 && /^[a-zA-Z]:[\\/]/.test(text)) return text.slice(0, 3)
      return text.slice(0, index)
    }

    function joinPath (parent, name) {
      if (typeof parent !== 'string' || parent === '') return name
      const separator = parent.includes('\\') ? '\\' : '/'
      return parent.replace(/[\\/]+$/, '') + separator + name
    }

    function validateLeaf (name) {
      if (typeof name !== 'string' || name.trim() === '') return 'error.nameEmpty'
      if (name !== name.trim()) return 'error.nameSpaces'
      if (name === '.' || name === '..') return 'error.nameInvalid'
      if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return 'error.nameInvalid'
      if (/[. ]$/.test(name)) return 'error.nameEnd'
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) return 'error.nameReserved'
      return undefined
    }

    function useLiveSessionId (useSessions) {
      const snapshot = useSessions((state) => state)
      return React.useMemo(() => {
        const byId = snapshot !== null && typeof snapshot === 'object' ? snapshot.byId ?? {} : {}
        for (const session of Object.values(byId)) {
          if (session !== null && session !== undefined && (session.retainedBy?.mainView ?? 0) > 0) return session.id
        }
        return undefined
      }, [snapshot])
    }

    function MoveDialog ({ t, workspace, liveSessionId, runCommand, pickDirectory, sessionsById, onClose }) {
      const [parent, setParent] = React.useState(() => dirName(workspace.path))
      const [name, setName] = React.useState(() => baseName(workspace.path) || 'workspace')
      const [busy, setBusy] = React.useState(false)
      const [picking, setPicking] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [result, setResult] = React.useState(null)
      const [blockers, setBlockers] = React.useState(null)
      const inputRef = React.useRef(null)

      function blockerTitle (blocker) {
        const row = sessionsById !== null && typeof sessionsById === 'object' ? sessionsById[blocker.id] : undefined
        const raw = row !== null && row !== undefined ? (row.title ?? row.titleSnapshot) : undefined
        const snapshot = raw !== null && typeof raw === 'object' ? (raw.val ?? raw.value) : raw
        if (typeof blocker.title === 'string' && blocker.title !== '') return `${blocker.title}（${blocker.id}）`
        if (typeof snapshot === 'string' && snapshot !== '') return `${snapshot}（${blocker.id}）`
        return blocker.id
      }

      React.useEffect(() => {
        const element = inputRef.current
        if (element !== null) {
          element.focus()
          if (typeof element.select === 'function') element.select()
        }
      }, [])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [busy, onClose])

      async function chooseParent () {
        if (typeof pickDirectory !== 'function') {
          setError(t('error.noPicker'))
          return
        }
        setPicking(true)
        setError(null)
        try {
          const picked = await pickDirectory()
          if (typeof picked === 'string' && picked !== '') setParent(picked)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setPicking(false)
        }
      }

      async function submit (force = false) {
        const leafError = validateLeaf(name)
        if (leafError !== undefined) {
          setError(t(leafError))
          return
        }
        if (parent.trim() === '') {
          setError(t('error.parentEmpty'))
          return
        }
        if (liveSessionId === undefined) {
          setError(t('error.noSession'))
          return
        }
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const payload = {
            workspaceId: workspace.workspaceId,
            targetParent: parent.trim(),
            name,
          }
          const checked = await runCommand(
            liveSessionId,
            '/workspace-relocate-check ' + JSON.stringify({
              workspaceId: workspace.workspaceId,
              forceCloseBlockers: force === true,
            }),
          )
          let parsed
          try { parsed = JSON.parse(checked) } catch { parsed = undefined }
          const list = parsed !== null && parsed !== undefined && Array.isArray(parsed.blockers) ? parsed.blockers : []
          const confirmation = parsed !== null && parsed !== undefined && typeof parsed.confirmation === 'string'
            ? parsed.confirmation
            : ''
          if (!force && list.length > 0) {
            if (list.some((blocker) => blocker !== null && blocker !== undefined && blocker.id === liveSessionId)) {
              setError(t('move.blockedSelf'))
              return
            }
            setBlockers(list)
            return
          }
          if (confirmation === '') throw new Error(t('error.confirmMissing'))
          const line = '/workspace-relocate-strict ' + JSON.stringify({
            ...payload,
            forceCloseBlockers: force === true,
            confirmation,
          })
          const text = await runCommand(liveSessionId, line)
          setBlockers(null)
          setResult(text || t('move.done'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        className: 'wso-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) onClose()
        },
      }, h('div', {
        className: 'wso-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wso-move-title',
      },
      h('h3', { id: 'wso-move-title' }, t('move.title')),
      h('div', { className: 'wso-field' },
        h('span', null, t('move.current')),
        h('div', { className: 'wso-path-box' }, workspace.path)),
      h('div', { className: 'wso-field' },
        h('label', { htmlFor: 'wso-parent' }, t('move.parent')),
        h('div', { className: 'wso-inline' },
          h('input', {
            id: 'wso-parent',
            type: 'text',
            value: parent,
            disabled: busy,
            spellCheck: false,
            onChange: (event) => setParent(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'wso-btn',
            disabled: busy || picking,
            onClick: chooseParent,
          }, picking ? t('move.picking') : t('move.pick')))),
      h('div', { className: 'wso-field' },
        h('label', { htmlFor: 'wso-name' }, t('move.name')),
        h('input', {
          id: 'wso-name',
          ref: inputRef,
          type: 'text',
          value: name,
          disabled: busy,
          spellCheck: false,
          onChange: (event) => setName(event.target.value),
        })),
      h('div', { className: 'wso-path-box' }, t('move.target', { path: joinPath(parent, name) })),
      h('p', { className: 'wso-note' }, t('move.note')),
      liveSessionId === undefined ? h('p', { className: 'wso-warn', role: 'status' }, t('noSession')) : null,
      error !== null ? h('p', { className: 'wso-error', role: 'alert' }, error) : null,
      result !== null ? h('pre', { className: 'wso-result', role: 'status' }, result) : null,
      blockers !== null ? h('div', { className: 'wso-confirm', role: 'alertdialog' },
        h('p', { className: 'wso-confirm-title' }, t('move.blockedTitle')),
        h('p', { className: 'wso-note' }, t('move.blockedBody')),
        h('ul', { className: 'wso-blockers' }, blockers.map((blocker) => h('li', { key: blocker.id }, blockerTitle(blocker)))),
        h('p', { className: 'wso-note' }, t('move.blockedQuestion')),
        h('div', { className: 'wso-actions' },
          h('button', {
            type: 'button',
            className: 'wso-btn',
            disabled: busy,
            onClick: () => setBlockers(null),
          }, t('move.forceNo')),
          h('button', {
            type: 'button',
            className: 'wso-btn wso-primary',
            disabled: busy,
            onClick: () => { void submit(true) },
          }, busy ? t('move.moving') : t('move.forceYes')))) : null,
      h('div', { className: 'wso-actions' },
        h('button', {
          type: 'button',
          className: 'wso-btn',
          disabled: busy,
          onClick: onClose,
        }, result !== null ? t('close') : t('cancel')),
        result === null
          ? h('button', {
            type: 'button',
            className: 'wso-btn wso-primary',
            disabled: busy || liveSessionId === undefined || blockers !== null,
            onClick: () => { void submit(false) },
          }, busy ? t('move.moving') : t('move.confirm'))
          : null)))
    }

    function OrganizeDialog ({ t, workspace, liveSessionId, runCommand, onClose }) {
      const [moveLoose, setMoveLoose] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [result, setResult] = React.useState(null)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [busy, onClose])

      async function submit () {
        if (liveSessionId === undefined) {
          setError(t('error.noSession'))
          return
        }
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const line = '/workspace-organize ' + JSON.stringify({
            workspaceId: workspace.workspaceId,
            moveLooseFiles: moveLoose,
          })
          const text = await runCommand(liveSessionId, line)
          setResult(text || t('organize.done'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        className: 'wso-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) onClose()
        },
      }, h('div', {
        className: 'wso-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wso-organize-title',
      },
      h('h3', { id: 'wso-organize-title' }, t('organize.title')),
      h('p', { className: 'wso-note' }, t('organize.intro', { path: workspace.path })),
      h('label', { className: 'wso-check' },
        h('input', {
          type: 'checkbox',
          checked: moveLoose,
          disabled: busy,
          onChange: (event) => setMoveLoose(event.target.checked),
        }),
        h('span', null, t('organize.loose'))),
      h('p', { className: 'wso-note' }, t('organize.looseNote')),
      liveSessionId === undefined ? h('p', { className: 'wso-warn', role: 'status' }, t('noSession')) : null,
      error !== null ? h('p', { className: 'wso-error', role: 'alert' }, error) : null,
      result !== null ? h('pre', { className: 'wso-result', role: 'status' }, result) : null,
      h('div', { className: 'wso-actions' },
        h('button', {
          type: 'button',
          className: 'wso-btn',
          disabled: busy,
          onClick: onClose,
        }, result !== null ? t('close') : t('cancel')),
        result === null
          ? h('button', {
            type: 'button',
            className: 'wso-btn wso-primary',
            disabled: busy || liveSessionId === undefined,
            onClick: submit,
          }, busy ? t('organize.busy') : t('organize.confirm'))
          : null)))
    }

    function SessionMoveDialog ({ t, session, workspaces, liveSessionId, runCommand, onClose }) {
      const options = React.useMemo(
        () => workspaces.filter((workspace) => workspace.workspaceId !== session.workspaceId),
        [workspaces, session.workspaceId],
      )
      const [targetId, setTargetId] = React.useState(options.length > 0 ? options[0].workspaceId : '')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [result, setResult] = React.useState(null)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [busy, onClose])

      async function submit () {
        if (liveSessionId === undefined) {
          setError(t('error.noSession'))
          return
        }
        if (targetId === '') {
          setError(t('sessionMove.noTarget'))
          return
        }
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const line = '/session-relocate ' + JSON.stringify({
            sessionId: session.id,
            targetWorkspaceId: targetId,
            sessionTitle: session.title,
          })
          const text = await runCommand(liveSessionId, line)
          setResult(text || t('sessionMove.done'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        className: 'wso-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) onClose()
        },
      }, h('div', {
        className: 'wso-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wso-session-move-title',
      },
      h('h3', { id: 'wso-session-move-title' }, t('sessionMove.title')),
      h('div', { className: 'wso-field' },
        h('span', null, t('sessions.workspace')),
        h('div', { className: 'wso-path-box' }, `${session.workspaceTitle} — ${session.title}`)),
      h('div', { className: 'wso-field' },
        h('label', { htmlFor: 'wso-session-target' }, t('sessionMove.target')),
        h('select', {
          id: 'wso-session-target',
          className: 'wso-select',
          value: targetId,
          disabled: busy || options.length === 0,
          onChange: (event) => setTargetId(event.target.value),
        }, options.map((workspace) => h('option', {
          value: workspace.workspaceId,
          key: workspace.workspaceId,
        }, workspace.title || workspace.path)))),
      options.length === 0 ? h('p', { className: 'wso-note' }, t('sessionMove.noTarget')) : null,
      h('p', { className: 'wso-note' }, t('sessionMove.note')),
      liveSessionId === undefined ? h('p', { className: 'wso-warn', role: 'status' }, t('noSession')) : null,
      error !== null ? h('p', { className: 'wso-error', role: 'alert' }, error) : null,
      result !== null ? h('pre', { className: 'wso-result', role: 'status' }, result) : null,
      h('div', { className: 'wso-actions' },
        h('button', {
          type: 'button',
          className: 'wso-btn',
          disabled: busy,
          onClick: onClose,
        }, result !== null ? t('close') : t('cancel')),
        result === null
          ? h('button', {
            type: 'button',
            className: 'wso-btn wso-primary',
            disabled: busy || liveSessionId === undefined || options.length === 0,
            onClick: submit,
          }, busy ? t('sessionMove.busy') : t('sessionMove.confirm'))
          : null)))
    }

    function BatchSessionMoveDialog ({ t, sessions, workspaces, liveSessionId, runCommand, onClose }) {
      const sourceIds = React.useMemo(() => new Set(sessions.map((session) => session.workspaceId)), [sessions])
      const options = React.useMemo(
        () => workspaces.filter((workspace) => !sourceIds.has(workspace.workspaceId)),
        [workspaces, sourceIds],
      )
      const [targetId, setTargetId] = React.useState(options.length > 0 ? options[0].workspaceId : '')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [result, setResult] = React.useState(null)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [busy, onClose])

      async function submit () {
        if (liveSessionId === undefined) {
          setError(t('error.noSession'))
          return
        }
        if (sessions.length === 0) {
          setError(t('sessionBatch.noSelection'))
          return
        }
        if (targetId === '') {
          setError(t('sessionMove.noTarget'))
          return
        }
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const titles = {}
          for (const session of sessions) titles[session.id] = session.title
          const line = '/session-relocate-batch ' + JSON.stringify({
            sessionIds: sessions.map((session) => session.id),
            targetWorkspaceId: targetId,
            sessionTitles: titles,
          })
          const text = await runCommand(liveSessionId, line)
          setResult(text || t('sessionBatch.done'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        className: 'wso-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) onClose()
        },
      }, h('div', {
        className: 'wso-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wso-session-batch-title',
      },
      h('h3', { id: 'wso-session-batch-title' }, t('sessionBatch.title')),
      h('div', { className: 'wso-field' },
        h('span', null, t('sessionBatch.selectedList')),
        h('div', { className: 'wso-batch-list' }, sessions.map((session) => h('div', {
          className: 'wso-batch-item',
          key: session.id,
        }, session.title, h('span', null, ` · ${session.workspaceTitle}`))))),
      h('div', { className: 'wso-field' },
        h('label', { htmlFor: 'wso-session-batch-target' }, t('sessionBatch.target')),
        h('select', {
          id: 'wso-session-batch-target',
          className: 'wso-select',
          value: targetId,
          disabled: busy || options.length === 0,
          onChange: (event) => setTargetId(event.target.value),
        }, options.map((workspace) => h('option', {
          value: workspace.workspaceId,
          key: workspace.workspaceId,
        }, workspace.title || workspace.path)))),
      options.length === 0 ? h('p', { className: 'wso-note' }, t('sessionMove.noTarget')) : null,
      h('p', { className: 'wso-note' }, t('sessionBatch.note')),
      liveSessionId === undefined ? h('p', { className: 'wso-warn', role: 'status' }, t('noSession')) : null,
      error !== null ? h('p', { className: 'wso-error', role: 'alert' }, error) : null,
      result !== null ? h('pre', { className: 'wso-result', role: 'status' }, result) : null,
      h('div', { className: 'wso-actions' },
        h('button', {
          type: 'button',
          className: 'wso-btn',
          disabled: busy,
          onClick: onClose,
        }, result !== null ? t('close') : t('cancel')),
        result === null
          ? h('button', {
            type: 'button',
            className: 'wso-btn wso-primary',
            disabled: busy || liveSessionId === undefined || sessions.length === 0 || options.length === 0,
            onClick: submit,
          }, busy ? t('sessionBatch.busy') : t('sessionBatch.confirm'))
          : null)))
    }

    function DeleteSessionsDialog ({ t, sessions, liveSessionId, runCommand, onClose }) {
      const [deleteWritten, setDeleteWritten] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [previewing, setPreviewing] = React.useState(false)
      const [preview, setPreview] = React.useState(null)
      const [confirmation, setConfirmation] = React.useState('')
      const [previewError, setPreviewError] = React.useState(null)
      const [previewVersion, setPreviewVersion] = React.useState(0)
      const [error, setError] = React.useState(null)
      const [result, setResult] = React.useState(null)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [busy, onClose])

      React.useEffect(() => {
        let cancelled = false
        if (liveSessionId === undefined || sessions.length === 0) {
          setPreview(null)
          setConfirmation('')
          setPreviewError(null)
          setPreviewing(false)
          return () => { cancelled = true }
        }
        setPreviewing(true)
        setPreview(null)
        setConfirmation('')
        setPreviewError(null)
        const titles = {}
        for (const session of sessions) titles[session.id] = session.title
        void (async () => {
          try {
            const raw = await runCommand(liveSessionId, '/session-delete-preview ' + JSON.stringify({
              sessionIds: sessions.map((session) => session.id),
              sessionTitles: titles,
              deleteWrittenFiles: deleteWritten,
            }))
            const parsed = JSON.parse(raw)
            if (!cancelled) {
              setPreview(typeof parsed.summary === 'string' ? parsed.summary : '')
              setConfirmation(typeof parsed.confirmation === 'string' ? parsed.confirmation : '')
            }
          } catch (failure) {
            if (!cancelled) {
              setPreviewError(failure instanceof Error ? failure.message : String(failure))
            }
          } finally {
            if (!cancelled) setPreviewing(false)
          }
        })()
        return () => { cancelled = true }
      }, [sessions, deleteWritten, liveSessionId, previewVersion])

      async function submit () {
        if (liveSessionId === undefined) {
          setError(t('error.noSession'))
          return
        }
        if (sessions.length === 0) {
          setError(t('sessionBatch.noSelection'))
          return
        }
        if (confirmation === '') {
          setError(t('error.confirmMissing'))
          return
        }
        setBusy(true)
        setError(null)
        setResult(null)
        try {
          const titles = {}
          for (const session of sessions) titles[session.id] = session.title
          const line = sessions.length === 1
            ? '/session-delete ' + JSON.stringify({
              sessionId: sessions[0].id,
              sessionTitle: sessions[0].title,
              deleteWrittenFiles: deleteWritten,
              confirmation,
            })
            : '/session-delete-batch ' + JSON.stringify({
              sessionIds: sessions.map((session) => session.id),
              sessionTitles: titles,
              deleteWrittenFiles: deleteWritten,
              confirmation,
            })
          const text = await runCommand(liveSessionId, line)
          setResult(text || t('sessionDelete.done'))
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setPreviewVersion((value) => value + 1)
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        className: 'wso-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) onClose()
        },
      }, h('div', {
        className: 'wso-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wso-session-delete-title',
      },
      h('h3', { id: 'wso-session-delete-title' }, sessions.length > 1 ? t('sessionDelete.batchTitle') : t('sessionDelete.title')),
      h('div', { className: 'wso-batch-list' }, sessions.map((session) => h('div', {
        className: 'wso-batch-item',
        key: session.id,
      }, session.title, h('span', null, ` · ${session.workspaceTitle}`)))),
      h('p', { className: 'wso-note' }, t('sessionDelete.note')),
      h('label', { className: 'wso-delete-check' },
        h('input', {
          type: 'checkbox',
          checked: deleteWritten,
          disabled: busy,
          onChange: (event) => setDeleteWritten(event.target.checked),
        }),
        h('span', null, t('sessionDelete.written'))),
      h('p', { className: 'wso-delete-note' }, t('sessionDelete.writtenNote')),
      previewing
        ? h('p', { className: 'wso-note' }, t('sessionDelete.previewing'))
        : (previewError !== null
            ? h('p', { className: 'wso-error', role: 'alert' }, previewError)
            : (preview !== null
                ? h('div', null,
                  h('div', { className: 'wso-note' }, t('sessionDelete.preview')),
                  h('pre', { className: 'wso-result', role: 'status' }, preview))
                : null)),
      liveSessionId === undefined ? h('p', { className: 'wso-warn', role: 'status' }, t('noSession')) : null,
      error !== null ? h('p', { className: 'wso-error', role: 'alert' }, error) : null,
      result !== null ? h('pre', { className: 'wso-result', role: 'status' }, result) : null,
      h('div', { className: 'wso-actions' },
        h('button', {
          type: 'button',
          className: 'wso-btn',
          disabled: busy,
          onClick: onClose,
        }, result !== null ? t('close') : t('cancel')),
        result === null
          ? h('button', {
            type: 'button',
            className: 'wso-btn wso-danger',
            disabled: busy || previewing || confirmation === '' || liveSessionId === undefined || sessions.length === 0,
            onClick: submit,
          }, busy ? t('sessionDelete.busy') : t('sessionDelete.confirm'))
          : null)))
    }

    function WorkspaceOrganizerSection (props) {
      const rawTranslate = props.t
      const t = typeof rawTranslate === 'function' ? rawTranslate : (key) => key
      const { useWorkspaces, useSessions, executeCommand, pickDirectory } = props
      const snapshot = useWorkspaces((state) => state)
      const liveSessionId = useLiveSessionId(useSessions)
      const sessionState = useSessions((state) => state)
      const sessionsById = sessionState !== null && typeof sessionState === 'object' &&
        sessionState.byId !== null && typeof sessionState.byId === 'object'
        ? sessionState.byId
        : {}
      const items = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.items)
        ? snapshot.items
        : []
      const [moving, setMoving] = React.useState(null)
      const [organizing, setOrganizing] = React.useState(null)
      const [sessionMoving, setSessionMoving] = React.useState(null)
      const [selected, setSelected] = React.useState(() => new Set())
      const [batchMoving, setBatchMoving] = React.useState(false)
      const [deleting, setDeleting] = React.useState(null)
      const sessionRows = React.useMemo(() => {
        const rows = []
        for (const workspace of items) {
          const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
          for (const sessionId of ids) {
            const session = sessionsById[sessionId]
            const title = typeof session?.title === 'string' && session.title.trim() !== ''
              ? session.title.trim()
              : sessionId
            rows.push({
              id: sessionId,
              title,
              workspaceId: workspace.workspaceId,
              workspaceTitle: workspace.title || workspace.path,
              current: (session?.retainedBy?.mainView ?? 0) > 0,
            })
          }
        }
        return rows
      }, [items, sessionsById])
      const selectedRows = React.useMemo(
        () => sessionRows.filter((row) => selected.has(row.id) && !row.current),
        [sessionRows, selected],
      )
      const toggleSelected = React.useCallback((sessionId) => {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(sessionId)) next.delete(sessionId)
          else next.add(sessionId)
          return next
        })
      }, [])
      const selectAllSessions = React.useCallback(() => {
        setSelected(new Set(sessionRows.filter((row) => !row.current).map((row) => row.id)))
      }, [sessionRows])
      const clearSelected = React.useCallback(() => setSelected(new Set()), [])

      const runCommand = React.useCallback(async (sessionId, line) => {
        if (typeof executeCommand !== 'function') throw new Error(t('error.unknownCommand'))
        const payload = await executeCommand(sessionId, line)
        if (payload === null || payload === undefined || payload.ok !== true) {
          const message = payload !== null && payload !== undefined && payload.error !== undefined
            ? payload.error.message ?? t('error.unknownCommand')
            : t('error.unknownCommand')
          throw new Error(message)
        }
        if (payload.value === null || payload.value === undefined) throw new Error(t('error.unknownCommand'))
        const outcome = payload.value.result
        if (outcome === null || outcome === undefined) throw new Error(t('error.noResult'))
        if (outcome.kind === 'error') throw new Error(outcome.text ?? t('error.noResult'))
        return outcome.text ?? ''
      }, [executeCommand, t])

      return h('div', { className: 'wso-page' },
        h('style', null, CSS),
        h('h2', null, t('title')),
        h('p', { className: 'wso-intro' }, t('intro')),
        h('p', { className: 'wso-note' }, t('sessionFoldersNote')),
        h('p', { className: 'wso-note' }, t('junctionNote')),
        liveSessionId === undefined ? h('p', { className: 'wso-warn', role: 'status' }, t('noSession')) : null,
        items.length === 0
          ? h('p', { className: 'wso-empty' }, t('listEmpty'))
          : h('div', { className: 'wso-list' }, items.map((workspace) => h('div', {
            className: 'wso-row',
            key: workspace.workspaceId,
          },
          h('div', { className: 'wso-main' },
            h('div', { className: 'wso-title' }, workspace.title || workspace.path),
            h('div', { className: 'wso-path', title: workspace.path }, workspace.path),
            h('div', { className: 'wso-meta' }, t('sessionsCount', { n: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0 }))),
          h('div', { className: 'wso-row-actions' },
            h('button', {
              type: 'button',
              className: 'wso-btn',
              onClick: () => setMoving(workspace),
            }, t('move')),
            h('button', {
              type: 'button',
              className: 'wso-btn',
              onClick: () => setOrganizing(workspace),
            }, t('organize')))))),

        h('h3', { className: 'wso-h3' }, t('sessions.title')),
        h('p', { className: 'wso-note' }, t('sessions.note')),
        sessionRows.length > 0 ? h('div', { className: 'wso-batch' },
          h('div', { className: 'wso-batch-info' }, t('sessions.selected', { n: selectedRows.length })),
          h('div', { className: 'wso-row-actions' },
            h('button', {
              type: 'button',
              className: 'wso-btn',
              disabled: sessionRows.every((row) => row.current),
              onClick: selectAllSessions,
            }, t('sessions.selectAll')),
            h('button', {
              type: 'button',
              className: 'wso-btn',
              disabled: selectedRows.length === 0,
              onClick: clearSelected,
            }, t('sessions.clear')),
            h('button', {
              type: 'button',
              className: 'wso-btn wso-primary',
              disabled: selectedRows.length === 0 || liveSessionId === undefined,
              onClick: () => setBatchMoving(true),
            }, t('sessions.batchMove')),
            h('button', {
              type: 'button',
              className: 'wso-btn wso-danger',
              disabled: selectedRows.length === 0 || liveSessionId === undefined,
              onClick: () => setDeleting(selectedRows),
            }, t('sessions.batchDelete')))) : null,
        sessionRows.length === 0
          ? h('p', { className: 'wso-empty' }, t('sessions.empty'))
          : h('div', { className: 'wso-sessions' }, sessionRows.map((row) => h('div', {
            className: 'wso-session',
            key: row.id,
          },
          h('input', {
            type: 'checkbox',
            className: 'wso-check',
            checked: selected.has(row.id),
            disabled: row.current,
            onChange: () => toggleSelected(row.id),
            'aria-label': t('sessions.batchMove'),
          }),
          h('div', { className: 'wso-session-main' },
            h('div', { className: 'wso-session-title' },
              h('span', null, row.title),
              row.current ? h('span', { className: 'wso-tag' }, t('sessions.current')) : null),
            h('div', { className: 'wso-meta' }, `${t('sessions.workspace')}: ${row.workspaceTitle}`)),
          h('div', { className: 'wso-row-actions' },
            h('button', {
              type: 'button',
              className: 'wso-btn',
              disabled: row.current || liveSessionId === undefined,
              onClick: () => setSessionMoving(row),
            }, t('sessions.move')),
            h('button', {
              type: 'button',
              className: 'wso-btn wso-danger',
              disabled: row.current || liveSessionId === undefined,
              onClick: () => setDeleting([row]),
            }, t('sessions.delete')))))),
        moving !== null ? h(MoveDialog, {
          t,
          workspace: moving,
          liveSessionId,
          runCommand,
          pickDirectory,
          sessionsById,
          onClose: () => setMoving(null),
        }) : null,
        organizing !== null ? h(OrganizeDialog, {
          t,
          workspace: organizing,
          liveSessionId,
          runCommand,
          onClose: () => setOrganizing(null),
        }) : null,
        sessionMoving !== null ? h(SessionMoveDialog, {
          t,
          session: sessionMoving,
          workspaces: items,
          liveSessionId,
          runCommand,
          onClose: () => setSessionMoving(null),
        }) : null,
        batchMoving ? h(BatchSessionMoveDialog, {
          t,
          sessions: selectedRows,
          workspaces: items,
          liveSessionId,
          runCommand,
          onClose: () => setBatchMoving(false),
        }) : null,
        deleting !== null ? h(DeleteSessionsDialog, {
          t,
          sessions: deleting,
          liveSessionId,
          runCommand,
          onClose: () => setDeleting(null),
        }) : null)
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands', 'remote.directoryPicker', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, MESSAGES))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'workspace-organizer',
          order: 12,
          label: () => ctx.locale.bind(NS)('section'),
          locale: NS,
          inject: () => ({
            executeCommand: async (sessionId, line) => {
              const commands = ctx.remote !== undefined && ctx.remote !== null ? ctx.remote.commands : undefined
              if (commands === undefined || typeof commands.execute !== 'function') {
                throw new Error('commands remote is unavailable')
              }
              return commands.execute(sessionId, line, [])
            },
            pickDirectory: async () => {
              if (ctx.uiWorkspace !== undefined && ctx.uiWorkspace !== null && typeof ctx.uiWorkspace.pickDirectory === 'function') {
                return ctx.uiWorkspace.pickDirectory()
              }
              const picker = ctx.remote !== undefined && ctx.remote !== null ? ctx.remote.directoryPicker : undefined
              if (picker !== undefined && typeof picker.pick === 'function') {
                const result = await picker.pick()
                return result !== undefined && result !== null && result.ok === true ? result.value : null
              }
              throw new Error('directory picker is unavailable')
            },
          }),
        }, WorkspaceOrganizerSection))
      },
    }
  },
})
