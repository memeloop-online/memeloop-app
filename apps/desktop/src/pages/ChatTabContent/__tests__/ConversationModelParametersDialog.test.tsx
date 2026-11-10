import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentModelConfig, ConversationModelParameters } from 'memeloop';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversationModelParametersDialog } from '../components/ConversationModelParametersDialog';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@memeloop/react-ui/agent', () => ({
  ModelParameterFields: ({ value, onChange }: { value: AgentModelConfig['parameters']; onChange: (value: AgentModelConfig['parameters']) => void }) => (
    <input
      aria-label='temperature'
      value={value?.temperature ?? ''}
      onChange={event => {
        onChange({ ...value, temperature: Number(event.target.value) });
      }}
    />
  ),
}));
const service = window.service as unknown as Record<string, unknown>;
const previous = service.agentInstance;
afterEach(() => {
  service.agentInstance = previous;
});

it('reopens from canonical remote metadata and saves the selected provider/model identity', async () => {
  document.body.addEventListener = EventTarget.prototype.addEventListener;
  document.body.removeEventListener = EventTarget.prototype.removeEventListener;
  let canonical: ConversationModelParameters = { selection: { providerId: 'first-provider', modelId: 'first-model', parameters: { temperature: 0.2 } } };
  const get = vi.fn(async () => canonical);
  const set = vi.fn(async (_id: string, selection: AgentModelConfig) => ({ selection }));
  service.agentInstance = { getConversationModelParameters: get, setConversationModelParameters: set };
  const initial = render(<ConversationModelParametersDialog agentId='conversation' onClose={() => {}} />);
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>('temperature').value).toBe('0.2');
  });
  initial.unmount();
  canonical = { selection: { providerId: 'remote-provider', modelId: 'remote-model', parameters: { temperature: 0.7, topP: 0.8 } } };
  const close = vi.fn();
  render(<ConversationModelParametersDialog agentId='conversation' onClose={close} />);
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>('temperature').value).toBe('0.7');
  });
  fireEvent.change(screen.getByLabelText('temperature'), { target: { value: '0.9' } });
  fireEvent.click(screen.getByRole('button', { name: 'EditAgent.Save' }));
  await waitFor(() => {
    expect(set).toHaveBeenCalledWith('conversation', {
      providerId: 'remote-provider',
      modelId: 'remote-model',
      parameters: { temperature: 0.9, topP: 0.8 },
    });
  });
  expect(close).toHaveBeenCalledOnce();
});
