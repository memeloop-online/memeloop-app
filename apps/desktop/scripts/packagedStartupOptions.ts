export interface PackagedStartupContext {
  platform?: NodeJS.Platform;
  ci?: boolean;
}

export function packagedStartupArgs(
  userDataDirectory: string,
  scenario: string,
  context: PackagedStartupContext = {},
): string[] {
  const platform = context.platform ?? process.platform;
  const isCi = context.ci ?? process.env.CI === 'true';
  const linuxCiSandboxArgs = platform === 'linux' && isCi
    ? ['--no-sandbox', '--disable-setuid-sandbox']
    : [];

  return [
    ...linuxCiSandboxArgs,
    `--user-data-dir=${userDataDirectory}`,
    `--test-scenario=${scenario}`,
  ];
}
