import { lazy } from 'react';

/** Async import can't mock in unit test, so re-export here and mock this file. */
export const subPages = {
  Agent: lazy(async () => await import('@/pages/Agent')),
};
