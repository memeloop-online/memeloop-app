import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@services/theme/defaultTheme';
import { BehaviorSubject } from 'rxjs';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Main from '../index';

const preferencesSubject = new BehaviorSubject({
  sidebar: true,
  tidgiMiniWindowShowSidebar: true,
  showSideBarText: true,
  showSideBarIcon: true,
});

Object.defineProperty(window.observables.preference, 'preference$', {
  value: preferencesSubject.asObservable(),
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
  const renderMain = (initialPath: string = '/') => {
    const { hook } = memoryLocation({
      path: initialPath,
      record: true,
    });
    const rendered = render(
      <HelmetProvider>
        <ThemeProvider theme={lightTheme}>
          <Router hook={hook}>
            <Main />
          </Router>
        </ThemeProvider>
      </HelmetProvider>,
    );
    return rendered;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display agent page content by default', async () => {
    renderMain();
    await waitFor(() => {
      expect(screen.getByTestId('agent-page')).toBeInTheDocument();
    });
    const agents = screen.getAllByTestId('agent-page');
    expect(agents.length).toBe(1);
  });

  it('should display project session sidebar', async () => {
    renderMain();
    await waitFor(() => {
      expect(screen.getByTestId('main-sidebar')).toBeInTheDocument();
    });
  });

  it('should display settings button in sidebar', async () => {
    renderMain();
    await waitFor(() => {
      expect(screen.getByTestId('SettingsIcon')).toBeInTheDocument();
    });
  });

  it('should switch to Guide page when navigating', async () => {
    renderMain('/guide');
    await waitFor(() => {
      expect(screen.getByTestId('guide-page')).toBeInTheDocument();
    });
    const guides = screen.getAllByTestId('guide-page');
    expect(guides.length).toBe(1);
  });

  it('should switch to Help page when navigating', async () => {
    renderMain('/help');
    await waitFor(() => {
      expect(screen.getByTestId('help-page')).toBeInTheDocument();
    });
    const helps = screen.getAllByTestId('help-page');
    expect(helps.length).toBe(1);
  });

  it('should navigate to agent page for unknown routes', async () => {
    renderMain('/unknown-route');
    await waitFor(() => {
      expect(screen.getByTestId('agent-page')).toBeInTheDocument();
    });
  });
});
