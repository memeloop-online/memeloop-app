import React from 'react';
import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  scheme: 'light' as 'light' | 'dark' | null,
  paperTheme: undefined as unknown,
  routerTheme: undefined as unknown,
  stackOptions: undefined as unknown,
  statusBarStyle: undefined as unknown,
  routerLight: {
    dark: false,
    colors: { background: 'router-light' },
    fonts: { regular: { fontFamily: 'System', fontWeight: '400' } },
  },
  routerDark: {
    dark: true,
    colors: { background: 'router-dark' },
    fonts: { regular: { fontFamily: 'System', fontWeight: '400' } },
  },
  paperLight: {
    dark: false,
    colors: {
      surface: '#fff',
      onSurface: '#111',
      background: '#fafafa',
      primary: '#6750a4',
      outline: '#79747e',
      error: '#b3261e',
    },
  },
  paperDark: {
    dark: true,
    colors: {
      surface: '#222',
      onSurface: '#eee',
      background: '#121212',
      primary: '#d0bcff',
      outline: '#938f99',
      error: '#f2b8b5',
    },
  },
}));

// Expo Router 57 vendors its navigation context. An external provider targets
// a different context even when both packages expose the same component name.
vi.mock('@react-navigation/native', () => {
  throw new Error('RootLayout must use the navigation context exported by expo-router');
});
vi.mock('expo-router', () => ({
  DefaultTheme: state.routerLight,
  DarkTheme: state.routerDark,
  ThemeProvider: ({ value, children }: { value: unknown; children: ReactNode }) => {
    state.routerTheme = value;
    return children;
  },
  Stack: Object.assign(
    ({ screenOptions, children }: { screenOptions: unknown; children: ReactNode }) => {
      state.stackOptions = screenOptions;
      return children;
    },
    { Screen: () => null },
  ),
}));
vi.mock('react-native', () => ({ useColorScheme: () => state.scheme }));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: state.paperLight,
  MD3DarkTheme: state.paperDark,
  PaperProvider: ({ theme, children }: { theme: unknown; children: ReactNode }) => {
    state.paperTheme = theme;
    return children;
  },
}));
vi.mock('expo-status-bar', () => ({
  StatusBar: ({ style }: { style: unknown }) => {
    state.statusBarStyle = style;
    return null;
  },
}));

import RootLayout from '../../app/_layout';

afterEach(cleanup);

it.each(['light', 'dark', null] as const)(
  'aligns Paper, Expo Router, header and status bar for the %s system scheme',
  (scheme) => {
    state.scheme = scheme;
    render(<RootLayout />);
    const dark = scheme === 'dark';
    const paper = dark ? state.paperDark : state.paperLight;
    const router = dark ? state.routerDark : state.routerLight;
    expect(state.paperTheme).toBe(paper);
    expect(state.routerTheme).toEqual({
      ...router,
      colors: {
        primary: paper.colors.primary,
        background: paper.colors.background,
        card: paper.colors.surface,
        text: paper.colors.onSurface,
        border: paper.colors.outline,
        notification: paper.colors.error,
      },
    });
    expect((state.routerTheme as typeof router).fonts).toBe(router.fonts);
    expect(state.stackOptions).toEqual({
      headerStyle: { backgroundColor: paper.colors.surface },
      headerTintColor: paper.colors.onSurface,
      contentStyle: { backgroundColor: paper.colors.background },
    });
    expect(state.statusBarStyle).toBe(dark ? 'light' : 'dark');
  },
);
