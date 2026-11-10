import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { ListItemButton } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import semver from 'semver';

import { ListItemText } from '@/components/ListItem';
import { usePromiseValue } from '@/helpers/useServiceValue';

export function NotificationTestItem(): React.JSX.Element | null {
  const { t } = useTranslation();
  const platformAndVersion = usePromiseValue(
    async () => await Promise.all([window.service.context.get('platform'), window.service.context.get('oSVersion')]),
    [undefined, undefined] as [string | undefined, string | undefined],
  );
  const platform = platformAndVersion?.[0];
  const oSVersion = platformAndVersion?.[1];

  return (
    <>
      <ListItemButton
        onClick={() => {
          void window.service.notification.show({
            title: t('Preference.TestNotification'),
            body: t('Preference.ItIsWorking'),
          });
        }}
      >
        <ListItemText
          primary={t('Preference.TestNotification')}
          secondary={(() => {
            if (platform === 'darwin' && oSVersion !== undefined && semver.gte(oSVersion, '10.15.0')) {
              return (
                <Trans t={t} i18nKey='Preference.MemeLoopTestNotificationDescription'>
                  <span>
                    If notifications do not appear, enable MemeLoop in
                    <b>System Settings → Notifications</b>.
                  </span>
                </Trans>
              );
            }
          })()}
        />
        <ChevronRightIcon color='action' />
      </ListItemButton>
    </>
  );
}
