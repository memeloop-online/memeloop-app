import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@services/theme/defaultTheme';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderAccountConfig } from 'memeloop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderConfig } from '../ProviderConfig';

const account: ProviderAccountConfig = {
  providerId: 'openai',
  providerType: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  models: [{ modelId: 'gpt-4', wireModelId: 'gpt-4', apiMode: 'chat-completions' }],
};

describe('ProviderConfig', () => {
  const setProviderAccounts = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.service.externalAPI, 'updateProvider', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(window.service.externalAPI, 'deleteProvider', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(window.service.externalAPI, 'getOfficialProviderAccounts', { value: vi.fn().mockResolvedValue([]), writable: true });
    Object.defineProperty(window, 'confirm', { value: vi.fn().mockReturnValue(true), writable: true });
  });

  const renderProviderConfig = (providerAccounts: readonly ProviderAccountConfig[] = [account]) =>
    render(
      <ThemeProvider theme={lightTheme}>
        <ProviderConfig providerAccounts={providerAccounts} setProviderAccounts={setProviderAccounts} />
      </ThemeProvider>,
    );

  it('renders canonical provider and route', () => {
    renderProviderConfig();
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByTestId('model-chip-gpt-4')).toBeInTheDocument();
  });

  it('deletes a provider through the canonical id', async () => {
    const user = userEvent.setup();
    renderProviderConfig();
    await user.click(screen.getByTestId('delete-provider-button'));
    await waitFor(() => {
      expect(window.service.externalAPI.deleteProvider).toHaveBeenCalledWith('openai');
    });
    expect(setProviderAccounts).toHaveBeenCalled();
  });

  it('opens the add provider form', async () => {
    const user = userEvent.setup();
    renderProviderConfig();
    await user.click(screen.getByTestId('add-new-provider-button'));
    expect(screen.getByTestId('add-provider-submit-button')).toBeInTheDocument();
  });
});
