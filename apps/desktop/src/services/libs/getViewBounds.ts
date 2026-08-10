import { WindowNames } from '@services/windows/WindowProperties';

export default async function getViewBounds(
  contentSize: [number, number],
  config: { findInPage?: boolean; windowName?: WindowNames },
): Promise<{ height: number; width: number; x: number; y: number }> {
  const { findInPage = false } = config;
  // Main content always occupies the full window now that the TidGi workspace
  // sidebar has been removed. Keep the windowName option for API compatibility.
  const x = 0;
  const y = 0;

  if (findInPage) {
    const FIND_IN_PAGE_HEIGHT = 42;
    return {
      x,
      y: y + FIND_IN_PAGE_HEIGHT,
      height: contentSize[1] - FIND_IN_PAGE_HEIGHT,
      width: contentSize[0] - x,
    };
  }

  return {
    x,
    y,
    height: contentSize[1],
    width: contentSize[0] - x,
  };
}
