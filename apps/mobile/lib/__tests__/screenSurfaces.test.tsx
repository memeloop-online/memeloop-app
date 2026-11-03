import React from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  background: '#fff',
  push: vi.fn(),
  network: { status: 'online', devices: [], pairingSessions: [] },
}));

vi.mock('react-native-get-random-values', () => ({}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  ScrollView: ({ children }: { children: ReactNode }) => <div data-testid="scroll">{children}</div>,
  FlatList: ({
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    ListHeaderComponent: ReactNode;
    ListEmptyComponent: ReactNode;
  }) => (
    <div data-testid="scroll">
      {ListHeaderComponent}
      {ListEmptyComponent}
    </div>
  ),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    edges,
    style,
  }: {
    children: ReactNode;
    edges: string[];
    style: Array<{ backgroundColor?: string }>;
  }) => (
    <div
      data-testid="safe-screen"
      data-edges={edges.join(',')}
      style={{ backgroundColor: Object.assign({}, ...style).backgroundColor }}
    >
      {children}
    </div>
  ),
}));
vi.mock('react-native-paper', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Button = ({
    children,
    onPress,
    disabled,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  );
  return {
    useTheme: () => ({ colors: { background: state.background, error: '#900' } }),
    Text: Container,
    Button,
    Chip: Container,
    Portal: Container,
    Divider: () => <hr />,
    TextInput: () => <input />,
    Card: Object.assign(
      ({ children, onPress }: { children: ReactNode; onPress?: () => void }) =>
        onPress ? <button onClick={onPress}>{children}</button> : <div>{children}</div>,
      {
        Title: ({ title, subtitle }: { title: string; subtitle?: string }) => (
          <div>
            {title}
            {subtitle}
          </div>
        ),
        Content: Container,
        Actions: Container,
      },
    ),
    Dialog: Object.assign(
      ({ visible, children }: { visible: boolean; children: ReactNode }) =>
        visible ? <section role="dialog">{children}</section> : null,
      { Title: Container, Content: Container, Actions: Container },
    ),
    List: {
      Section: Container,
      Subheader: Container,
      Icon: () => null,
      Item: ({ title, description }: { title: string; description: string }) => (
        <div>
          {title}
          {description}
        </div>
      ),
    },
  };
});
vi.mock('../deviceNetwork', () => ({
  mobileDeviceNetwork: {
    getState: () => state.network,
    subscribe: () => vi.fn(),
    start: () => Promise.resolve(),
  },
}));
vi.mock('../orchestration', () => ({
  MOBILE_ORCHESTRATION_CAPABILITIES: { operations: [] },
  createPairedDeviceOrchestrationClient: vi.fn(),
}));

import HomeScreen from '../../app/index';
import NodesScreen from '../../app/nodes';
import SettingsScreen from '../../app/settings';
import { getMobileLabels } from '../i18n';

afterEach(() => {
  cleanup();
  state.push.mockReset();
});

describe.each([
  ['light', '#ffffff'],
  ['dark', '#17121c'],
])('%s host surfaces', (_name, background) => {
  it.each([
    ['home', HomeScreen],
    ['nodes', NodesScreen],
    ['settings', SettingsScreen],
  ])('%s uses the Paper background and bottom-safe scrollable content', (_screen, Screen) => {
    state.background = background;
    render(<Screen />);
    const safe = screen.getByTestId('safe-screen');
    expect(safe.style.backgroundColor).toBe(background === '#ffffff' ? 'rgb(255, 255, 255)' : 'rgb(23, 18, 28)');
    expect(safe.dataset.edges).toBe('left,right,bottom');
    expect(safe.contains(screen.getByTestId('scroll'))).toBe(true);
  });
});

it('keeps pairing CTA inside the bottom safe area and preserves its dialog', () => {
  render(<NodesScreen />);
  const button = screen.getByRole('button', { name: getMobileLabels().nodes.pairDesktop });
  expect(screen.getByTestId('safe-screen').contains(button)).toBe(true);
  expect(screen.getByTestId('scroll').contains(button)).toBe(false);
  fireEvent.click(button);
  expect(screen.getByRole('dialog').textContent).toContain(getMobileLabels().nodes.pairDialogTitle);
});

it('preserves home navigation through the scrollable cards', () => {
  render(<HomeScreen />);
  fireEvent.click(screen.getByText(getMobileLabels().home.chatDescription));
  expect(state.push).toHaveBeenCalledWith('/chat');
});
