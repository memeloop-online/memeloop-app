import { Typography } from '@mui/material';

import type { ICustomSectionProps } from '@services/preferences/definitions/types';
import { Paper, SectionTitle } from '../PreferenceComponents';

export function Search(
  props: ICustomSectionProps & { showInfoSnackbar?: (payload: { message: string; severity?: 'error' | 'warning' | 'info' | 'success' }) => void },
): React.JSX.Element {
  void props; // unused props - reserved for future search settings
  void props.showInfoSnackbar; // reserved for future use

  return (
    <>
      <SectionTitle ref={props.sectionRef}>Search</SectionTitle>
      <Paper elevation={0}>
        <Typography variant='body2' color='text.secondary' sx={{ p: 2 }}>
          Search settings will be available in a future update.
        </Typography>
      </Paper>
    </>
  );
}
