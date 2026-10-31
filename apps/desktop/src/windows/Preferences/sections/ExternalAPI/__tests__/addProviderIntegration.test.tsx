import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@services/theme/defaultTheme';
import { render, screen, waitFor } from '@testing-library/react';
import type { ModelAssignments, ProviderAccountConfig } from 'memeloop';
import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalAPI } from '../index';

const account: ProviderAccountConfig = {
  providerId: 'existing-provider',
  providerType: 'openai',
  baseUrl: 'https://api.example.com/v1',
  enabled: true,
  models: [{ modelId: 'gpt-4o', wireModelId: 'gpt-4o', apiMode: 'chat-completions' }],
};
const assignments: ModelAssignments = { default: { providerId: account.providerId, modelId: 'gpt-4o' } };

describe('ExternalAPI provider integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.service.externalAPI, 'getProviderAccounts', { value: vi.fn().mockResolvedValue([account]), writable: true });
    Object.defineProperty(window.service.externalAPI, 'getModelAssignments', { value: vi.fn().mockResolvedValue(assignments), writable: true });
    Object.defineProperty(window.service.externalAPI, 'getOfficialProviderAccounts', { value: vi.fn().mockResolvedValue([]), writable: true });
    Object.defineProperty(window.service.externalAPI, 'updateProvider', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(window.service.externalAPI, 'deleteProvider', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(window.observables, 'externalAPI', {
      value: { modelAssignments$: new BehaviorSubject(assignments), providerAccounts$: new BehaviorSubject<readonly ProviderAccountConfig[]>([account]) },
      writable: true,
    });
  });

  it('renders existing canonical provider models and add controls', async () => {
    render(
      <ThemeProvider theme={lightTheme}>
        <ExternalAPI sectionRef={React.createRef()} onNeedsRestart={() => {}} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('model-chip-gpt-4o')).toBeInTheDocument());
    expect(screen.getByTestId('add-new-provider-button')).toBeInTheDocument();
  });
});
