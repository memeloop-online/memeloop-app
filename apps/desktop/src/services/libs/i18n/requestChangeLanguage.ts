import { I18NChannels } from '@/constants/channels';
import { container } from '@services/container';
import type { IContextService } from '@services/context/interface';
import type { IMenuService } from '@services/menu/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IViewService } from '@services/view/interface';
import type { IWindowService } from '@services/windows/interface';
import { i18n } from '.';

export async function requestChangeLanguage(newLanguage: string): Promise<void> {
  const contextService = container.get<IContextService>(serviceIdentifier.Context);
  const windowService = container.get<IWindowService>(serviceIdentifier.Window);
  const viewService = container.get<IViewService>(serviceIdentifier.View);
  const menuService = container.get<IMenuService>(serviceIdentifier.MenuService);

  await i18n.changeLanguage(newLanguage);
  viewService.forEachView((_view) => {
    _view.webContents.send(I18NChannels.changeLanguageRequest, {
      lng: newLanguage,
    });
  });
  await windowService.sendToAllWindows(I18NChannels.changeLanguageRequest, {
    lng: newLanguage,
  });

  await menuService.buildMenu();
}
