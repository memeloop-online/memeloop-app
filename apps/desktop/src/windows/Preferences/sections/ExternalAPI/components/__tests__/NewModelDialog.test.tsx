import type { DialogProps } from '@mui/material';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyModelForm } from '../modelForm';
import { NewModelDialog } from '../NewModelDialog';

vi.mock('@mui/material', async importOriginal => {
  const material = await importOriginal<typeof import('@mui/material')>();
  return { ...material, Dialog: ({ children, open }: Pick<DialogProps, 'children' | 'open'>) => open ? <div role='dialog'>{children}</div> : null };
});

describe('NewModelDialog', () => {
  const props = {
    open: true,
    onClose: vi.fn(),
    onAddModel: vi.fn(),
    currentProvider: 'openai',
    providerClass: 'openai',
    newModelForm: { ...createEmptyModelForm(), wireModelId: 'gpt-test', displayName: 'Friendly model' },
    availableDefaultModels: [],
    selectedDefaultModel: '',
    onSelectDefaultModel: vi.fn(),
    onModelFormChange: vi.fn(),
    editMode: false,
  };

  it('asks for provider model ID and display name without exposing an internal ID', () => {
    render(<NewModelDialog {...props} />);
    expect(screen.getByDisplayValue('gpt-test')).toBeInTheDocument();
    expect(screen.getByLabelText('Preference.ModelCaption')).toHaveValue('Friendly model');
    expect(screen.queryByLabelText('Preference.ModelName')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Preference.WireModelId')).toBeInTheDocument();
    expect(screen.getByTestId('model-advanced-toggle').parentElement).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Preference.MaxOutputTokens')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Preference.AddNewModel' })).toBeInTheDocument();
  });

  it('keeps advanced values through expansion and resets to collapsed when reopened', async () => {
    const configured = { ...props, newModelForm: { ...props.newModelForm, maxOutputTokens: '1200', temperature: '0.3' } };
    const view = render(<NewModelDialog {...configured} />);
    fireEvent.click(screen.getByTestId('model-advanced-toggle'));
    await waitFor(() => expect(screen.getByTestId('model-advanced-toggle').parentElement).toHaveAttribute('open'));
    expect(screen.getByLabelText('Preference.MaxOutputTokens')).toHaveValue(1200);
    expect(screen.getByLabelText('Preference.TemperatureDefault')).toHaveValue(0.3);
    view.rerender(<NewModelDialog {...configured} open={false} />);
    view.rerender(<NewModelDialog {...configured} />);
    await waitFor(() => expect(screen.getByTestId('model-advanced-toggle').parentElement).not.toHaveAttribute('open'));
    expect(screen.getByLabelText('Preference.MaxOutputTokens')).toHaveValue(1200);
  });

  it('reveals invalid optional settings instead of silently disabling save', async () => {
    const onAddModel = vi.fn();
    render(<NewModelDialog {...props} newModelForm={{ ...props.newModelForm, maxOutputTokens: '-1' }} onAddModel={onAddModel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preference.AddNewModel' }));
    await waitFor(() => expect(screen.getByTestId('model-advanced-toggle').parentElement).toHaveAttribute('open'));
    expect(screen.getByText('Preference.MaxOutputTokensInvalid')).toBeVisible();
    expect(onAddModel).not.toHaveBeenCalled();
  });

  it('saves a valid model without opening advanced settings', () => {
    const onAddModel = vi.fn();
    render(<NewModelDialog {...props} onAddModel={onAddModel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preference.AddNewModel' }));
    expect(onAddModel).toHaveBeenCalledOnce();
    expect(screen.getByTestId('model-advanced-toggle').parentElement).not.toHaveAttribute('open');
  });

  it('loads selected preset route into the form', () => {
    const onModelFormChange = vi.fn();
    render(
      <NewModelDialog
        {...props}
        availableDefaultModels={[{ modelId: 'preset', wireModelId: 'preset-wire', apiMode: 'responses', requestDefaults: { maxOutputTokens: 200 } }]}
        selectedDefaultModel='preset'
        onModelFormChange={onModelFormChange}
      />,
    );
    expect(onModelFormChange).toHaveBeenCalledWith('modelId', 'preset');
    expect(onModelFormChange).toHaveBeenCalledWith('wireModelId', 'preset-wire');
  });
});
