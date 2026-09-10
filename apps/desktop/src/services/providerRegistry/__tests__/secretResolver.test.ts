import type { IDatabaseService } from '@services/database/interface';
import { describe, expect, it, vi } from 'vitest';

import { SecretResolver } from '../secretResolver';

describe('SecretResolver initialization', () => {
  it('does not read settings until the database-backed service is initialized', () => {
    const getSetting = vi.fn(() => undefined);
    const resolver = new SecretResolver({ getSetting } as unknown as IDatabaseService);

    expect(getSetting).not.toHaveBeenCalled();
    resolver.initialize();
    resolver.initialize();

    expect(getSetting).toHaveBeenCalledOnce();
    expect(getSetting).toHaveBeenCalledWith('aiProviderSecrets');
  });
});
