import { app } from 'electron';
import { getMemeLoopProductionUserDataPath, MEMELOOP_APP_USER_MODEL_ID, MEMELOOP_PRODUCT_NAME } from './constants/productIdentity';

/**
 * This module must be the first import of the main entry point. In particular,
 * it has to run before appPaths, settings, logging or database modules evaluate
 * their path constants.
 */
if (typeof app?.setName === 'function') {
  app.setName(MEMELOOP_PRODUCT_NAME);
}

if (process.platform === 'win32' && typeof app?.setAppUserModelId === 'function') {
  app.setAppUserModelId(MEMELOOP_APP_USER_MODEL_ID);
}

const isDevelopmentOrTest = process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'test' ||
  process.argv.some(argument => argument.startsWith('--test-scenario='));

if (!isDevelopmentOrTest && typeof app?.getPath === 'function' && typeof app?.setPath === 'function') {
  app.setPath('userData', getMemeLoopProductionUserDataPath(app.getPath('appData')));
}
