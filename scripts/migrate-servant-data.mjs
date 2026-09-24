/**
 * One-shot data migration: `com.servant.shiro` -> `com.servant.desktop`.
 *
 * The rename moved the bundle identifier, and the identifier *is* the data
 * directory: without this step the first launch of the renamed build looks like
 * a fresh install — no chat history, no memory database, no saved LLM key — and
 * the setup wizard asks to download 1.4 GB of models that are already on disk.
 *
 * Three directories move, each an instant same-volume rename:
 *
 *   %APPDATA%\com.servant.shiro      -> %APPDATA%\com.servant.desktop
 *        chat history, LanceDB memory, `.venv-memory`, provisioning state
 *   %LOCALAPPDATA%\com.servant.shiro -> %LOCALAPPDATA%\com.servant.desktop
 *        WebView2 profile: localStorage (LLM key, UI prefs, window placement)
 *   %LOCALAPPDATA%\Shiro             -> %LOCALAPPDATA%\Servant
 *        model-roots.json, the per-user hint that lets another build reuse
 *        already-downloaded models (`sharedModelRoots.ts`)
 *
 * Dry-run by default. Pass `--yes` to move. Close the app first: WebView2 keeps
 * its profile open and the rename will fail while it runs.
 */
import { cpSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--yes');

/** [what it holds, old path, new path] */
function plan() {
  const roaming = process.env.APPDATA;
  const local = process.env.LOCALAPPDATA;
  const entries = [];
  if (roaming) {
    entries.push([
      '用户数据（聊天记录、记忆库、.venv-memory、初始化状态）',
      path.join(roaming, 'com.servant.shiro'),
      path.join(roaming, 'com.servant.desktop')
    ]);
  }
  if (local) {
    entries.push([
      'WebView2 配置（localStorage：LLM Key、界面设置、窗口位置）',
      path.join(local, 'com.servant.shiro'),
      path.join(local, 'com.servant.desktop')
    ]);
    entries.push([
      '共享模型根提示（model-roots.json）',
      path.join(local, 'Shiro'),
      path.join(local, 'Servant')
    ]);
  }
  return entries;
}

/** Bounded recursive size: a `.venv-memory` holds tens of thousands of files. */
function describe(directory) {
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const walk = (current) => {
    if (files > 20000) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else {
        files += 1;
        try {
          bytes += statSync(target).size;
        } catch {
          /* unreadable file: count it, ignore its size */
        }
      }
    }
  };
  walk(directory);
  const megabytes = (bytes / 1024 / 1024).toFixed(1);
  return `${files} 个文件 / ${megabytes} MB${truncated ? '（统计已截断）' : ''}`;
}

/** Same volume: a rename is instant and atomic. Cross-volume: copy, then drop. */
function move(from, to) {
  try {
    renameSync(from, to);
    return 'renamed';
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
    return 'copied';
  }
}

let moved = 0;
let skipped = 0;
for (const [label, from, to] of plan()) {
  if (!existsSync(from)) {
    console.log(`— 跳过（不存在）：${from}`);
    skipped += 1;
    continue;
  }
  if (existsSync(to)) {
    console.log(`— 跳过（目标已存在，请人工核对）：${to}`);
    skipped += 1;
    continue;
  }
  console.log(`${APPLY ? '→ 迁移' : '→ 待迁移'} ${label}`);
  console.log(`   从 ${from}  (${describe(from)})`);
  console.log(`   到 ${to}`);
  if (!APPLY) continue;
  try {
    console.log(`   完成：${move(from, to)}`);
    moved += 1;
  } catch (error) {
    console.error(`   失败：${error.message}`);
    console.error('   如果提示被占用，请先完全退出应用（含托盘图标与 servant-server 进程）再重试。');
    process.exitCode = 1;
  }
}

if (!APPLY) {
  console.log(`\n共 ${plan().length} 项，${skipped} 项跳过。确认无误后执行：npm run migrate:data -- --yes`);
} else {
  console.log(`\n已迁移 ${moved} 项，跳过 ${skipped} 项。`);
  console.log('提示：环境变量 SHIRO_* 已改名 SERVANT_*，Shell 或 bat 里的旧变量需手动更新。');
}
