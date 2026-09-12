import { container } from '@services/container';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';

export function initializeObservables() {
  const preferenceService = container.get<IPreferenceService>(serviceIdentifier.Preference);
  preferenceService.updatePreferenceSubject();
}
