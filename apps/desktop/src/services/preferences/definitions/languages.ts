import LanguageIcon from '@mui/icons-material/Language';
import type { ISectionDefinition } from './types';

export const languagesSection: ISectionDefinition = {
  id: 'languages',
  titleKey: 'Preference.Languages',
  Icon: LanguageIcon,
  items: [
    {
      type: 'custom',
      titleKey: 'Preference.ChooseLanguage',
      componentId: 'languages.selector',
    },
  ],
};
