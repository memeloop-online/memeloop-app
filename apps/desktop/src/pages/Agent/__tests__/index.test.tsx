import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

import { ThemeProvider } from '@mui/material/styles';
import { PreferenceSections } from '@services/preferences/interface';
import { lightTheme } from '@services/theme/defaultTheme';
import { WindowNames } from '@services/windows/WindowProperties';
import Agent from '../index';

vi.mock('../components/TabStoreInitializer', () => ({
  TabStoreInitializer: () => React.createElement('div', { 'data-testid': 'agent-tabs-initializer' }),
}));

vi.mock('../TabContent/TabContentArea', () => ({
  TabContentArea: () => React.createElement('div', { 'data-testid': 'agent-tab-content' }),
}));

const mockGetInitializationStatus = vi.fn();
const mockOpen = vi.fn();
const mockLog = vi.fn();

function renderAgent() {
  return render(
    <ThemeProvider theme={lightTheme}>
      <Agent />
    </ThemeProvider>,
  );
}

describe('Agent startup state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue(undefined);
    mockLog.mockResolvedValue(undefined);
    window.service = {
      agentDefinition: { getInitializationStatus: mockGetInitializationStatus },
      native: { log: mockLog },
      window: { open: mockOpen },
    } as unknown as typeof window.service;
  });

  it('keeps Agent actions unavailable while starting and mounts them after a ready transition', async () => {
    mockGetInitializationStatus
      .mockResolvedValueOnce({ state: 'starting', recoveryRequired: false })
      .mockResolvedValueOnce({ state: 'ready', recoveryRequired: false });

    renderAgent();

    expect(screen.getByTestId('agent-starting-state')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-tabs-initializer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-tab-content')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetInitializationStatus).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(mockGetInitializationStatus).toHaveBeenCalledTimes(2);
    }, { timeout: 1000 });
    await waitFor(() => {
      expect(screen.getByTestId('agent-tabs-initializer')).toBeInTheDocument();
      expect(screen.getByTestId('agent-tab-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('agent-starting-state')).not.toBeInTheDocument();
  });

  it('fails closed when unavailable and opens the Agent database settings section', async () => {
    mockGetInitializationStatus.mockResolvedValue({ state: 'unavailable', recoveryRequired: true });

    renderAgent();

    expect(await screen.findByTestId('agent-unavailable-state')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-tabs-initializer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-tab-content')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId('agent-recovery-open-settings'));

    expect(mockOpen).toHaveBeenCalledWith(WindowNames.preferences, {
      preferenceGotoTab: PreferenceSections.aiAgent,
    });
  });

  it('shows the localized recovery state without exposing the database error', async () => {
    mockGetInitializationStatus.mockRejectedValue(new Error('temporary_agent_definitions.systemPrompt is missing'));

    renderAgent();

    expect(await screen.findByTestId('agent-unavailable-state')).toBeInTheDocument();
    expect(screen.getByText('AgentRecovery.Title')).toBeInTheDocument();
    expect(screen.queryByText(/temporary_agent_definitions/)).not.toBeInTheDocument();
    expect(mockLog).toHaveBeenCalledWith(
      'error',
      'Agent page could not read initialization status',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});
