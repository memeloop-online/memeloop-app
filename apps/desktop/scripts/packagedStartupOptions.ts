export interface PackagedStartupContext {
  platform?: NodeJS.Platform;
  ci?: boolean;
}

export function packagedStartupArguments(
  userDataDirectory: string,
  scenario: string,
  context: PackagedStartupContext = {},
): string[] {
  const platform = context.platform ?? process.platform;
  const isCi = context.ci ?? process.env.CI === 'true';
  const linuxCiSandboxArguments = platform === 'linux' && isCi
    ? ['--no-sandbox', '--disable-setuid-sandbox']
    : [];

  return [
    ...linuxCiSandboxArguments,
    `--user-data-dir=${userDataDirectory}`,
    `--test-scenario=${scenario}`,
  ];
}
