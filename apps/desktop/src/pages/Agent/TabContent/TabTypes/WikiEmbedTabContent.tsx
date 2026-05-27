import React from 'react';
import { Typography } from '@mui/material';

interface WikiEmbedTabContentProps {
  tab: { workspaceId?: string };
  isSplitView?: boolean;
}

/**
 * Wiki Embed Tab Content - Stub component
 * Wiki embedding is no longer supported since workspace management was removed.
 */
export const WikiEmbedTabContent: React.FC<WikiEmbedTabContentProps> = () => {
  return (
    <Typography color='text.secondary' sx={{ p: 2 }}>
      Wiki embedding is no longer available.
    </Typography>
  );
};
