export enum PageType {
  /**
   * Default empty page, have some user guide and new user settings.
   */
  guide = 'guide',
  /**
   * Show list of available help resources.
   */
  help = 'help',
  /**
   * Chat page for AI agents.
   */
  agent = 'agent',
  /** @deprecated Add workspace page - no longer supported */
  add = 'add',
}
export const defaultCreatedPageTypes: PageType[] = [PageType.agent, PageType.help, PageType.guide];
export function isMainWindowPage(pageType: PageType | undefined): boolean {
  if (!pageType) return false;
  return defaultCreatedPageTypes.includes(pageType);
}
