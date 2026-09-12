/**
 * Load electron-unhandled through native dynamic import. Version 5 is pure
 * ESM and cannot be required from Forge's CommonJS main bundle.
 */
interface UnhandledOptions {
  showDialog?: boolean;
  logger?: (error: Error) => void;
  reportButton?: (error: Error) => void;
}

export async function setupUnhandled(options: UnhandledOptions): Promise<void> {
  const module = await import('electron-unhandled');
  module.default(options);
}
