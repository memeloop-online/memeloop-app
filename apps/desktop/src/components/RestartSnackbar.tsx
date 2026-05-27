import CloseIcon from '@mui/icons-material/Close';
import { Button, IconButton, Snackbar, Tooltip } from '@mui/material';
import { keyframes, styled } from '@mui/material/styles';
import useDebouncedCallback from 'beautiful-react-hooks/useDebouncedCallback';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const progressAnimation = keyframes`
  from {
    width: 0%;
  }

  to {
    width: 100%;
  }
`;
const RestartButton = styled(Button)<{ time: number }>`
  .MuiButton-label {
    z-index: 1;
  }
  .MuiTouchRipple-root {
    z-index: 0;
    background-color: white;
    animation: ${progressAnimation} ${({ time }) => time}ms linear;
  }
`;
const anchorOrigin = { vertical: 'bottom', horizontal: 'center' } as const;

export function useRestartSnackbar(
  configs?: { waitBeforeCountDown?: number; waitBeforeRestart?: number },
): [() => void, React.JSX.Element] {
  const { waitBeforeCountDown = 1000, waitBeforeRestart = 10_000 } = configs ?? {};
  const { t } = useTranslation();
  const [opened, openedSetter] = useState(false);
  const [inCountDown, inCountDownSetter] = useState(false);
  const [currentWaitBeforeRestart, currentWaitBeforeRestartSetter] = useState(waitBeforeRestart);

  const handleCloseAndRestart = useCallback(async () => {
    openedSetter(false);
    inCountDownSetter(false);
    await window.service.window.requestRestart();
  }, []);

  const handleCancelRestart = useCallback(() => {
    openedSetter(false);
    inCountDownSetter(false);
  }, [openedSetter]);

  const startRestartCountDown = useDebouncedCallback(
    () => {
      inCountDownSetter(true);
      openedSetter(true);
    },
    [openedSetter, inCountDown, inCountDownSetter],
    waitBeforeCountDown,
    { leading: false },
  );

  const requestRestartCountDown = useCallback(() => {
    if (inCountDown) {
      // if already started,refresh count down of autoHideDuration, so the count down will rerun
      // so if user is editing userName in the config, count down will refresh on each onChange of Input
      currentWaitBeforeRestartSetter(currentWaitBeforeRestart + 1);
    } else {
      // of not started, we try start it
      startRestartCountDown();
    }
  }, [inCountDown, currentWaitBeforeRestart, startRestartCountDown]);

  return [
    requestRestartCountDown,
    <div key='RestartSnackbar'>
      <Snackbar
        anchorOrigin={anchorOrigin}
        open={opened}
        onClose={(_event, reason) => {
          switch (reason) {
            case 'timeout': {
              if (inCountDown) {
                void handleCloseAndRestart();
              }
              break;
            }
            case 'clickaway': {
              handleCancelRestart();
              break;
            }
          }
        }}
        message={t('Dialog.RestartMessage')}
        autoHideDuration={currentWaitBeforeRestart}
        action={
          <>
            <RestartButton
              key={currentWaitBeforeRestart}
              time={currentWaitBeforeRestart}
              color='secondary'
              size='small'
              onClick={handleCloseAndRestart}
            >
              {t('Dialog.RestartAppNow')}
            </RestartButton>
            <Tooltip title={<span>{t('Dialog.Later')}</span>}>
              <IconButton size='small' aria-label='close' color='inherit' onClick={handleCancelRestart}>
                <CloseIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          </>
        }
      />
    </div>,
  ];
}
