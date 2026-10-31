import { I18NChannels } from '@/constants/channels';
import { container } from '@services/container';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IWindowService } from '@services/windows/interface';
import { i18n } from '.';

export async function requestChangeLanguage(newLanguage: string): Promise<void> {
  const windowService = container.get<IWindowService>(serviceIdentifier.Window);

  await i18n.changeLanguage(newLanguage);
  await windowService.sendToAllWindows(I18NChannels.changeLanguageRequest, {
    lng: newLanguage,
  });
}
