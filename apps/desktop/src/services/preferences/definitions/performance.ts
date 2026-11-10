import PowerIcon from '@mui/icons-material/Power';
import { z } from 'zod';
import type { ISectionDefinition } from './types';

export const performanceSection: ISectionDefinition = {
  id: 'performance',
  titleKey: 'Preference.Performance',
  Icon: PowerIcon,
  items: [
    {
      type: 'preference-boolean',
      key: 'useHardwareAcceleration',
      titleKey: 'Preference.hardwareAcceleration',
      needsRestart: true,
      zod: z.boolean(),
    },
  ],
};
