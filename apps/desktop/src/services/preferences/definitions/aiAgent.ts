import StorageIcon from '@mui/icons-material/Storage';
import type { ISectionDefinition } from './types';

export const aiAgentSection: ISectionDefinition = {
  id: 'aiAgent',
  titleKey: 'Preference.AIAgent',
  ns: 'agent',
  Icon: StorageIcon,
  items: [
    {
      type: 'action',
      titleKey: 'Preference.AIAgentManage',
      descriptionKey: 'Preference.AIAgentManageDescription',
      ns: 'agent',
      handler: 'aiAgent.manage',
    },
    { type: 'divider' },
    {
      type: 'action',
      titleKey: 'Preference.NodeManagement',
      descriptionKey: 'Preference.NodeManagementDescription',
      ns: 'agent',
      handler: 'deviceNetwork.openManagement',
    },
  ],
};
