import '@testing-library/jest-dom/vitest';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { PageType } from '@/constants/pageTypes';
import { lightTheme } from '@services/theme/defaultTheme';
import Main from '../index';

const pageTypes = [PageType.agent, PageType.help, PageType.guide, PageType.add];

function createWorkspaces() {
  return pageTypes.map((pageType, index) => ({
    id: pageType,
    name: pageType,
    pageType,
    order: index,
    metadata: {},
  }));
}

const workspacesSubject = new BehaviorSubject(createWorkspaces());

Object.defineProperty(window.observables.workspace, 'workspaces$', {
  value: workspacesSubject.asObservable(),
  writable: true,
});

vi.mock('../subPages', () => ({
  subPages: {
    Help: () => <div data-testid='help-page'>Help Page Content</div>,
    Guide: () => <div data-testid='guide-page'>Guide Page Content</div>,
    Agent: () => <div data-testid='agent-page'>Agent Page Content</div>,
  },
}));

describe('Main Page', () => {
  const renderMain = (initialPath = '/') => {
    const { hook } = memoryLocation({ path: initialPath, record: true });
    render(
      <HelmetProvider>
        <ThemeProvider theme={lightTheme}>
          <Router hook={hook}>
            <Main />
          </Router>
        </ThemeProvider>
      </HelmetProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    workspacesSubject.next(createWorkspaces());
  });

  it('renders the agent page full-width without the TidGi workspace sidebar', async () => {
    renderMain();

    expect(await screen.findByTestId('agent-page')).toBeInTheDocument();
    expect(screen.queryByTestId('main-sidebar')).not.toBeInTheDocument();
  });

  it('keeps the built-in routes available without workspace selector UI', async () => {
    renderMain(`/${PageType.help}`);

    expect(await screen.findByTestId('help-page')).toBeInTheDocument();
    expect(screen.queryByTestId('main-sidebar')).not.toBeInTheDocument();
  });
});
