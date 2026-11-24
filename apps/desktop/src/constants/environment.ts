import { isElectronDevelopment } from './isElectronDevelopment';
export { isElectronDevelopment };

export const hasTestScenarioArgument = (
  argv: readonly string[] | undefined,
  preloadDetectedTestScenario = false,
): boolean => preloadDetectedTestScenario || argv?.some(argument => argument.startsWith('--test-scenario=')) === true;

const runtimeArgv = typeof process === 'undefined' || !Array.isArray(process.argv) ? undefined : process.argv;
const preloadDetectedTestScenario = typeof window !== 'undefined' && window.memeloopRuntime?.hasTestScenarioArgument;

// Packaged e2e runs do not reliably preserve NODE_ENV, so we also key off the explicit scenario arg.
export const isTest = process.env.NODE_ENV === 'test' || hasTestScenarioArgument(runtimeArgv, preloadDetectedTestScenario);
export const isDevelopmentOrTest = isElectronDevelopment || isTest;
