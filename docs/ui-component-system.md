# UI 组件规范

新页面优先从 `src/ui/design-system` 导入 Mantine 组件；图标继续用 `lucide-react`，页面布局和品牌视觉用现有 CSS 与主题变量完成。避免新页面再造 Button、输入框、弹窗等基础控件。

全应用由 `ServantDesignSystem` 提供主题：夜金使用暗色外观，月白和樱梦使用亮色外观；主题色来自 `uiPreferences`。Mantine 组件通过 npm 依赖升级，升级时检查官方 changelog 并运行 `npm run typecheck`、`npm run build`。

`src/ui/shared/ServantControls` 暂作旧页面兼容层。改旧页面时按页面逐步迁移，不要一次性替换其控件样式。
