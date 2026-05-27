import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '@mui/material/styles';
import { AiAPIConfig } from '@services/agentInstance/promptConcat/promptConcatSchema';
import { lightTheme } from '@services/theme/defaultTheme';
import { BehaviorSubject } from 'rxjs';

import { AIProviderConfig, ModelFeature, ModelInfo } from '@services/providerRegistry/interface';
import { ExternalAPI } from '../index';

// Mock data
const mockLanguageModel: ModelInfo = {
  name: 'gpt-4',
  caption: 'GPT-4 Language Model',
  features: ['language' as ModelFeature],
};

const mockEmbeddingModel: ModelInfo = {
  name: 'text-embedding-3-small',
  caption: 'OpenAI Embedding Model',
  features: ['embedding' as ModelFeature],
};

const mockSpeechModel: ModelInfo = {
  name: 'gpt-speech',
  caption: 'GPT Speech',
  features: ['speech' as ModelFeature],
};

const mockImageModel: ModelInfo = {
  name: 'dall-e',
  caption: 'DALL-E',
  features: ['imageGeneration' as ModelFeature],
};

const mockTranscriptionsModel: ModelInfo = {
  name: 'whisper',
  caption: 'Whisper',
  features: ['transcriptions' as ModelFeature],
};

const mockFreeModel: ModelInfo = {
  name: 'gpt-free',
  caption: 'GPT Free',
  features: ['free' as ModelFeature],
};

const mockProvider: AIProviderConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  baseURL: 'https://api.openai.com/v1',
  models: [
    mockLanguageModel,
    mockEmbeddingModel,
    mockSpeechModel,
    mockImageModel,
    mockTranscriptionsModel,
    mockFreeModel,
  ],
  providerClass: 'openai',
  isPreset: false,
  enabled: true,
};

const mockAIConfig = {
  default: {
    provider: 'openai',
    model: 'gpt-4',
  },
  embedding: {
    provider: 'openai',
    model: 'text-embedding-3-small',
  },
  speech: {
    provider: 'openai',
    model: 'gpt-speech',
  },
  imageGeneration: {
    provider: 'openai',
    model: 'dall-e',
  },
  transcriptions: {
    provider: 'openai',
    model: 'whisper',
  },
  free: {
    provider: 'openai',
    model: 'gpt-free',
  },
  modelParameters: {
    temperature: 0.7,
    topP: 0.95,
  },
};

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={lightTheme}>
    {children}
  </ThemeProvider>
);

describe('ExternalAPI Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ExternalAPI service methods
    Object.defineProperty(window.service.externalAPI, 'getAIProviders', {
      value: vi.fn().mockResolvedValue([mockProvider]),
      writable: true,
    });

    Object.defineProperty(window.service.externalAPI, 'getAIConfig', {
      value: vi.fn().mockResolvedValue(mockAIConfig),
      writable: true,
    });

    Object.defineProperty(window.service.externalAPI, 'updateDefaultAIConfig', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
    });

    Object.defineProperty(window.service.externalAPI, 'updateProvider', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
    });

    Object.defineProperty(window.service.externalAPI, 'deleteProvider', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
    });

    // Mock the new delete field API
    Object.defineProperty(window.service.externalAPI, 'deleteFieldFromDefaultAIConfig', {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
    });

    // Mock observables for externalAPI
    Object.defineProperty(window.observables, 'externalAPI', {
      value: {
        defaultConfig$: new BehaviorSubject<AiAPIConfig>(mockAIConfig),
        providers$: new BehaviorSubject<AIProviderConfig[]>([mockProvider]),
      },
      writable: true,
    });
  });

  // Helper function to render ExternalAPI with theme wrapper and wait for loading to complete
  const renderExternalAPI = async () => {
    const result = render(
      <TestWrapper>
        <ExternalAPI sectionRef={React.createRef()} onNeedsRestart={() => {}} />
      </TestWrapper>,
    );

    // Wait for initial loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading')).not.toBeInTheDocument();
    });

    // Wait for provider panel to finish initializing (delete button appears after form state is set)
    await waitFor(() => {
      expect(screen.getByTestId('delete-provider-button')).toBeInTheDocument();
    });

    return result;
  };

  it('should render loading state initially', async () => {
    // Don't await here to test the loading state
    render(
      <TestWrapper>
        <ExternalAPI sectionRef={React.createRef()} onNeedsRestart={() => {}} />
      </TestWrapper>,
    );
    expect(screen.getByText('Loading')).toBeInTheDocument();

    // Wait for loading to complete to avoid act warnings for subsequent async updates
    await waitFor(() => {
      expect(screen.queryByText('Loading')).not.toBeInTheDocument();
    });
  });

  it('should render provider configuration after loading', async () => {
    await renderExternalAPI();

    // Should show provider configuration section (may appear in multiple places)
    expect(screen.getAllByText('Preference.ProviderConfiguration').length).toBeGreaterThan(0);
    // Should show add provider button
    const addProviderButton = screen.getByTestId('add-new-provider-button');
    expect(addProviderButton).toBeInTheDocument();
  });

  it('should render add new provider button', async () => {
    await renderExternalAPI();

    // Should show add new provider button
    const addProviderButton = screen.getByTestId('add-new-provider-button');
    expect(addProviderButton).toBeInTheDocument();
    expect(addProviderButton).toHaveTextContent('Preference.AddNewProvider');
  });

  it('should call deleteProvider API when provider delete button is clicked', async () => {
    const user = userEvent.setup();

    // Mock window.confirm to return true (user confirms deletion)
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);

    await renderExternalAPI();

    // Wait for the provider panel to render (containing the delete button)
    await waitFor(() => {
      expect(screen.getByTestId('delete-provider-button')).toBeInTheDocument();
    });

    // Find and click the delete provider button
    const deleteButton = screen.getByTestId('delete-provider-button');
    await user.click(deleteButton);

    // Verify the delete API was called
    await waitFor(() => {
      expect(window.service.externalAPI.deleteProvider).toHaveBeenCalledWith('openai');
    });

    // Restore original confirm
    window.confirm = originalConfirm;
  });
});
