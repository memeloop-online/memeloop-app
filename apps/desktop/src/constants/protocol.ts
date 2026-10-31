import { isTest } from './environment';
import { MEMELOOP_PROTOCOL } from './productIdentity';

/**
 * Protocol scheme used for deep linking
 * Test mode uses a different protocol to avoid conflicts with production
 *
 * Note: This file is for main process only, not for renderer/shared code
 */
export const MEMELOOP_PROTOCOL_SCHEME = isTest ? `${MEMELOOP_PROTOCOL}-test` : MEMELOOP_PROTOCOL;
