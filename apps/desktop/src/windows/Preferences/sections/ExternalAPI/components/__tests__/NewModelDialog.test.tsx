import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyModelForm } from '../modelForm';
import { NewModelDialog } from '../NewModelDialog';

describe('NewModelDialog', () => {
  const props = {
    open: true,
    onClose: vi.fn(),
    onAddModel: vi.fn(),
    currentProvider: 'openai',
    providerClass: 'openai',
    newModelForm: { ...createEmptyModelForm(), modelId: 'gpt-test' },
    availableDefaultModels: [],
    selectedDefaultModel: '',
    onSelectDefaultModel: vi.fn(),
    onModelFormChange: vi.fn(),
    editMode: false,
  };

  it('renders canonical route fields', () => {
    render(<NewModelDialog {...props} />);
    expect(screen.getByDisplayValue('gpt-test')).toBeInTheDocument();
    expect(screen.getByLabelText('Wire model id')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preference.AddModel' })).toBeInTheDocument();
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
