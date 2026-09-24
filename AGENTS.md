# Project Notes

- Before development, read `docs/development-brief.md` first.
- 需要用户决定或者任务完成, 播放一次音频提醒用户 (".\public\assets\fx\iron-basin-hit.wav")

不要以“最小改动”为第一目标，以“保持模块边界、降低下一次同类功能开发成本”为第一目标。发现当前结构不适合需求时，可以先重构再实现。

删除前先 git status --porcelain 存一份快照；
优先 git rm，让 git 管删除，别用 rm / Remove-Item；
真要"移走"就用 Move-Item 到仓库外隔离目录（E:\airi\_codex-list-stale-drafts\ 这套做法）；
给 shim 传的路径一律用正斜杠；
删完用 git status --ignored=matching 核对源码目录。