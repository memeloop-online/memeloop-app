import '@testing-library/jest-dom/vitest';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { lightTheme } from '@services/theme/defaultTheme';
import Main from '../index';

vi.mock('../subPages', () => ({
  subPages: {
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
  });

  it('renders the agent page full-width without the TidGi workspace sidebar', async () => {
    renderMain();

    expect(await screen.findByTestId('agent-page')).toBeInTheDocument();
    expect(screen.queryByTestId('main-sidebar')).not.toBeInTheDocument();
  });

  it('falls back to the agent page for removed TidGi routes', async () => {
    renderMain('/legacy-workspace');

    expect(await screen.findByTestId('agent-page')).toBeInTheDocument();
    expect(screen.queryByTestId('main-sidebar')).not.toBeInTheDocument();
  });
});
