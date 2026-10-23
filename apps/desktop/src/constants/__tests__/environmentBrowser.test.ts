import { describe, expect, it } from 'vitest';
import { hasTestScenarioArgument } from '../environment';

describe('sandboxed renderer environment detection', () => {
  it('does not require a Node process global', () => {
    expect(hasTestScenarioArgument(undefined)).toBe(false);
  });

  it('preserves packaged E2E scenarios exposed by preload', () => {
    expect(hasTestScenarioArgument(undefined, true)).toBe(true);
    expect(hasTestScenarioArgument(['electron', '--test-scenario=pairing'])).toBe(true);
  });
});
