import type { ReactNode } from 'react';
import { createTheme, MantineProvider } from '@mantine/core';
import { useUiTheme } from '../../app/settings/useUiTheme';

/**
 * 全站正文字体栈（得意黑 → 系统兜底）。与 `src/ui/fonts.css` 的
 * `--font-sans` 是同一条栈：
 * Mantine 把主题里的 fontFamily 写进内联样式，拿不到 CSS 变量，只能重复一份。
 */
export const SERVANT_FONT_SANS =
  "'Smiley Sans', 'Smiley Sans Oblique', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif";

/**
 * Mantine 默认把根字号设成 16px，本项目（`fonts.css` 的 `:root`）的 rem 基准
 * 现在同样是 16px，**两边已经一致**，所以倍率就是 1（不缩放）。
 *
 * 历史：基准曾是 14px，那时要写 14/16 = 0.875 才能对齐。阶梯整条 +2px 后
 * 正文回到 16px，这个对冲就不再需要了——留着反而会让 Mantine 组件比
 * 全站其他部分小 12.5%。
 *
 * 保留常量而不是删掉 `scale` 字段：将来若再调基准，改这一个数就能同步。
 */
const SERVANT_SCALE = 1;

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
    // 对齐 fonts.css 的根字号（现为 16px，与 Mantine 默认一致）。
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
    // 对齐 fonts.css 的根字号（现为 16px，与 Mantine 默认一致）。
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
    // 对齐 fonts.css 的根字号（现为 16px，与 Mantine 默认一致）。
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
