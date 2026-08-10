import { describe, expect, it } from 'vitest';

import { WindowNames } from '@services/windows/WindowProperties';
import getViewBounds from '../getViewBounds';

describe('getViewBounds', () => {
  it.each([
    ['main window', WindowNames.main],
    ['TidGi mini window', WindowNames.tidgiMiniWindow],
    ['secondary window', WindowNames.secondary],
  ])('uses the full width for the %s', async (_label, windowName) => {
    await expect(getViewBounds([1_200, 800], { windowName })).resolves.toEqual({
      x: 0,
      y: 0,
      width: 1_200,
      height: 800,
    });
  });

  it('keeps the full width when the find-in-page bar is shown', async () => {
    await expect(getViewBounds([1_200, 800], { findInPage: true, windowName: WindowNames.main })).resolves.toEqual({
      x: 0,
      y: 42,
      width: 1_200,
      height: 758,
    });
  });
});
