import type { IAuthenticationService } from '@services/auth/interface';
import { container } from '@services/container';
import type { IPreferenceService } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';

export function initializeObservables() {
  const authService = container.get<IAuthenticationService>(serviceIdentifier.Authentication);
  const preferenceService = container.get<IPreferenceService>(serviceIdentifier.Preference);
  authService.updateUserInfoSubject();
  preferenceService.updatePreferenceSubject();
}
