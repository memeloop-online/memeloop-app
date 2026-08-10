import WidgetsIcon from '@mui/icons-material/Widgets';
import { z } from 'zod';
import type { ISectionDefinition } from './types';

export const generalSection: ISectionDefinition = {
  id: 'general',
  titleKey: 'Preference.General',
  Icon: WidgetsIcon,
  items: [
    {
      type: 'preference-boolean',
      key: 'rememberLastPageVisited',
      titleKey: 'Preference.RememberLastVisitState',
      needsRestart: true,
      zod: z.boolean(),
    },
    { type: 'divider' },
    {
      type: 'preference-enum',
      key: 'themeSource',
      titleKey: 'Preference.Theme',
      enumValues: ['system', 'light', 'dark'],
      enumNames: ['Preference.SystemDefaultTheme', 'Preference.LightTheme', 'Preference.DarkTheme'],
      zod: z.enum(['system', 'light', 'dark']),
    },
    { type: 'divider' },
    { type: 'divider' },
    {
      type: 'preference-boolean',
      key: 'titleBar',
      titleKey: 'Preference.ShowTitleBar',
      descriptionKey: 'Preference.ShowTitleBarDetail',
      needsRestart: true,
      zod: z.boolean(),
    },
    {
      type: 'preference-boolean',
      key: 'hideMenuBar',
      titleKey: 'Preference.HideMenuBar',
      descriptionKey: 'Preference.HideMenuBarDetail',
      needsRestart: true,
      platform: '!darwin',
      zod: z.boolean(),
    },
    { type: 'divider' },
    {
      type: 'preference-boolean',
      key: 'alwaysOnTop',
      titleKey: 'Preference.AlwaysOnTop',
      descriptionKey: 'Preference.AlwaysOnTopDetail',
      needsRestart: true,
      zod: z.boolean(),
    },
    { type: 'divider' },
    {
      type: 'preference-boolean',
      key: 'runOnBackground',
      titleKey: 'Preference.RunOnBackground',
      descriptionKey: 'Preference.RunOnBackgroundDetail',
      zod: z.boolean(),
    },
    {
      type: 'preference-boolean',
      key: 'swipeToNavigate',
      titleKey: 'Preference.SwipeWithThreeFingersToNavigate',
      descriptionKey: 'Preference.SwipeWithThreeFingersToNavigateDescription',
      needsRestart: true,
      platform: 'darwin',
      zod: z.boolean(),
    },
  ],
};
