import '@testing-library/jest-dom/vitest';
import type { DialogProps } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@services/theme/defaultTheme';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderAccountConfig } from 'memeloop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderConfig } from '../ProviderConfig';

vi.mock('@mui/material', async importOriginal => {
  const material = await importOriginal<typeof import('@mui/material')>();
  return { ...material, Dialog: ({ children, open }: Pick<DialogProps, 'children' | 'open'>) => open ? <div role='dialog'>{children}</div> : null };
});

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

  it('saves only the supplied provider ID and display name into canonical route/catalog fields', async () => {
    const user = userEvent.setup();
    renderProviderConfig();
    await user.click(screen.getByTestId('add-new-model-button'));
    await user.type(screen.getByLabelText('Preference.WireModelId'), 'vendor/custom-v2');
    await user.type(screen.getByLabelText('Preference.ModelCaption'), 'Custom model');
    expect(screen.getByLabelText('Preference.WireModelId')).toHaveValue('vendor/custom-v2');
    expect(screen.getByLabelText('Preference.ModelCaption')).toHaveValue('Custom model');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preference.AddNewModel' }));
    await waitFor(() => {
      expect(window.service.externalAPI.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          models: expect.arrayContaining([{ modelId: 'vendor/custom-v2', wireModelId: 'vendor/custom-v2', apiMode: 'chat-completions' }]),
          catalogProvider: expect.objectContaining({ models: [expect.objectContaining({ id: 'vendor/custom-v2', name: 'Custom model' })] }),
        }),
        undefined,
      );
    });
  });

  it('retains existing catalog metadata and logical ID when editing provider ID and display name', async () => {
    const user = userEvent.setup();
    renderProviderConfig([{
      ...account,
      catalogProvider: { id: 'openai', name: 'OpenAI', env: [], models: [{ id: 'gpt-4', name: 'Original', reasoning: true, attachment: false, toolCall: true }] },
    }]);
    await user.click(screen.getByTestId('model-chip-gpt-4'));
    const wire = screen.getByLabelText('Preference.WireModelId');
    await user.clear(wire);
    await user.type(wire, 'provider/replacement');
    const name = screen.getByLabelText('Preference.ModelCaption');
    await user.clear(name);
    await user.type(name, 'Renamed');
    expect(wire).toHaveValue('provider/replacement');
    expect(name).toHaveValue('Renamed');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preference.Save' }));
    await waitFor(() => {
      expect(window.service.externalAPI.updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [{ modelId: 'gpt-4', wireModelId: 'provider/replacement', apiMode: 'chat-completions' }],
          catalogProvider: expect.objectContaining({ models: [expect.objectContaining({ id: 'gpt-4', name: 'Renamed', reasoning: true })] }),
        }),
        undefined,
      );
    });
  });

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

  it('offers key entry when a secret reference resolves to an empty value', async () => {
    renderProviderConfig([{ ...account, secretRef: 'ai-provider/openai' }]);
    await waitFor(() => {
      expect(window.service.externalAPI.getProviderApiKey).toHaveBeenCalledWith('openai');
    });
    expect(screen.getByTestId('provider-api-key-input')).toHaveValue('');
    expect(screen.getByTestId('provider-api-key-input')).toHaveAttribute('placeholder', 'Preference.APIKeyPlaceholder');
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
