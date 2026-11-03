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
    Object.defineProperty(window.service.externalAPI, 'getProviderApiKey', { value: vi.fn().mockResolvedValue(undefined), writable: true });
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

  it('hydrates a saved API key into the provider input', async () => {
    const getProviderApiKey = vi.fn().mockResolvedValue('saved-api-key');
    Object.defineProperty(window.service.externalAPI, 'getProviderApiKey', { value: getProviderApiKey, writable: true });
    renderProviderConfig([{ ...account, secretRef: 'ai-provider/openai' }]);

    await waitFor(() => {
      expect(screen.getByTestId('provider-api-key-input')).toHaveValue('saved-api-key');
    });
    expect(getProviderApiKey).toHaveBeenCalledWith('openai');
  });

  it('does not replace a key typed while saved value is loading', async () => {
    const user = userEvent.setup();
    let resolveSavedKey!: (value: string) => void;
    const savedKey = new Promise<string>(resolve => {
      resolveSavedKey = resolve;
    });
    Object.defineProperty(window.service.externalAPI, 'getProviderApiKey', { value: vi.fn(() => savedKey), writable: true });
    renderProviderConfig([{ ...account, secretRef: 'ai-provider/openai' }]);
    const input = screen.getByTestId('provider-api-key-input');

    await user.type(input, 'typed-key');
    resolveSavedKey('saved-api-key');
    await waitFor(() => {
      expect(input).toHaveValue('typed-key');
    });
  });
});
