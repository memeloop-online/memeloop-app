import type { IPreferences } from '../interface';

/**
 * A side effect that runs after a preference value changes.
 * `newValue` is the new preference value, `preferences` is the full current state.
 */
type SideEffectFunction = (newValue: unknown, preferences: IPreferences) => Promise<void>;

const sideEffects: Record<string, SideEffectFunction> = {};

export function getSideEffect(id: string): SideEffectFunction | undefined {
  return sideEffects[id];
}
