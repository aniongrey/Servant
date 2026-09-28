import type { ReactNode } from 'react';
import { createTheme, MantineProvider } from '@mantine/core';
import { useUiTheme } from '../../app/settings/useUiTheme';

/**
 * 全站正文字体栈（得意黑 → 思源黑体 → 系统兜底）。与 `src/ui/fonts.css` 的
 * `--font-sans` 是同一条栈：
 * Mantine 把主题里的 fontFamily 写进内联样式，拿不到 CSS 变量，只能重复一份。
 */
export const SERVANT_FONT_SANS =
  "'Smiley Sans', 'Smiley Sans Oblique', 'Source Han Sans SC', 'Source Han Sans CN', 'Source Han Sans', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif";

/**
 * Mantine 默认把根字号设成 16px，而本项目（`fonts.css` 的 `:root`）钉的是 14px。
 * 两套基准并存时，任何写在 Mantine 子树里的 rem 都会比其他地方大 14%。
 *
 * `scale` 是 Mantine 的倍率（默认 1，根 16px），所以 14/16 = 0.875 才能对齐。
 * 现在全站字号已走 px 令牌，这条主要防回归。
 */
const SERVANT_SCALE = 0.875;

const themes = {
  nocturne: createTheme({
    primaryColor: 'servant',
    colors: {
      servant: [
        '#f7f0dd',
        '#ead9af',
        '#dbc78f',
        '#cbb578',
        '#c5a56b',
        '#a9874f',
        '#8c7042',
        '#735f3d',
        '#59472e',
        '#3e3221'
      ]
    },
    defaultRadius: 'sm',
    // 对齐 fonts.css 的 14px 根字号（Mantine 默认根 16px）。
    scale: SERVANT_SCALE,
    // 与 `fonts.css` 的 `--font-sans` 保持一致：Mantine 用内联样式下发字体，
    // 不受 CSS 变量继承影响，所以这里必须给出字面量——改了字体栈要同时改两处。
    fontFamily: SERVANT_FONT_SANS
  }),
  moonlight: createTheme({
    primaryColor: 'servant',
    colors: {
      servant: [
        '#f2f6fb',
        '#e4ebf4',
        '#ced9e8',
        '#b5c4d8',
        '#96abc5',
        '#7d95b3',
        '#607493',
        '#4d6281',
        '#394d6a',
        '#29384b'
      ]
    },
    defaultRadius: 'sm',
    // 对齐 fonts.css 的 14px 根字号（Mantine 默认根 16px）。
    scale: SERVANT_SCALE,
    // 与 `fonts.css` 的 `--font-sans` 保持一致：Mantine 用内联样式下发字体，
    // 不受 CSS 变量继承影响，所以这里必须给出字面量——改了字体栈要同时改两处。
    fontFamily: SERVANT_FONT_SANS
  }),
  sakura: createTheme({
    primaryColor: 'servant',
    colors: {
      servant: [
        '#fff3f9',
        '#f8e4f0',
        '#efd0e3',
        '#e1b9d3',
        '#cb96bc',
        '#b575a0',
        '#965382',
        '#81456f',
        '#703965',
        '#54294b'
      ]
    },
    defaultRadius: 'sm',
    // 对齐 fonts.css 的 14px 根字号（Mantine 默认根 16px）。
    scale: SERVANT_SCALE,
    // 与 `fonts.css` 的 `--font-sans` 保持一致：Mantine 用内联样式下发字体，
    // 不受 CSS 变量继承影响，所以这里必须给出字面量——改了字体栈要同时改两处。
    fontFamily: SERVANT_FONT_SANS
  })
} as const;

export function ServantDesignSystem({ children }: { children: ReactNode }) {
  const theme = useUiTheme();
  return (
    <MantineProvider theme={themes[theme]} forceColorScheme={theme === 'nocturne' ? 'dark' : 'light'}>
      {children}
    </MantineProvider>
  );
}
