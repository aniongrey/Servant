import type { ReactNode } from 'react';
import { createTheme, MantineProvider } from '@mantine/core';
import { useUiTheme } from '../../app/settings/useUiTheme';

const themes = {
  nocturne: createTheme({
    primaryColor: 'servant',
    colors: { servant: ['#f7f0dd', '#ead9af', '#dbc78f', '#cbb578', '#c5a56b', '#a9874f', '#8c7042', '#735f3d', '#59472e', '#3e3221'] },
    defaultRadius: 'sm',
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', sans-serif"
  }),
  moonlight: createTheme({
    primaryColor: 'servant',
    colors: { servant: ['#f2f6fb', '#e4ebf4', '#ced9e8', '#b5c4d8', '#96abc5', '#7d95b3', '#607493', '#4d6281', '#394d6a', '#29384b'] },
    defaultRadius: 'sm',
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', sans-serif"
  }),
  sakura: createTheme({
    primaryColor: 'servant',
    colors: { servant: ['#fff3f9', '#f8e4f0', '#efd0e3', '#e1b9d3', '#cb96bc', '#b575a0', '#965382', '#81456f', '#703965', '#54294b'] },
    defaultRadius: 'sm',
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', sans-serif"
  })
} as const;

export function ServantDesignSystem({ children }: { children: ReactNode }) {
  const theme = useUiTheme();
  return (
    <MantineProvider
      theme={themes[theme]}
      forceColorScheme={theme === 'nocturne' ? 'dark' : 'light'}
    >
      {children}
    </MantineProvider>
  );
}
