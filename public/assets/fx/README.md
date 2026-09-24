# 摸头与防摸头资源

可以直接用自己的文件同名覆盖：

- `iron-basin.png`：防摸头铁盆图片。推荐透明背景 PNG，横向构图。
- `iron-basin-hit.wav`：敲铁盆的金属音效。推荐无开头静音的短 WAV；当前版本为 0.72 秒。
- `ei.wav`、`en.wav`、`no.wav`、`uhe.wav`、`yeah.wav`：普通摸头随机音效。
- `motoufx.mp3`：1% 概率触发的稀有摸头音效。

开发版覆盖后刷新页面或重启桌宠；已打包版本需要重新构建。
只切换角色或重新挂载预览不会重新加载音效，因为解码后的 AudioBuffer 会常驻当前页面内存。

播放与预加载入口：`src/character/vrm/headTouchAudio.ts`。
图片入口：`src/character/vrm/VrmStage.tsx`；显示尺寸在 `src/ui/styles.css` 的 `.protectedEffect img`。

铁盆图片使用内置 ImageGen 生成；提示为：透明背景、单独倒扣的银灰色金属洗脸盆，作为动漫桌宠的防摸头头盔，带卷边、金属反光和锤纹，不含人物、文字或水印。
敲击 WAV 使用非整数倍共振频率和短冲击噪声离线合成。
