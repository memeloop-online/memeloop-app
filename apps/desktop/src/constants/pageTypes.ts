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
   * A TiddlyWiki workspace page.
   */
  wiki = 'wiki',
  /**
   * Chat page for AI agents.
   */
  agent = 'agent',
  /** Special page type for the add-workspace button. */
  add = 'add',
}
export const defaultCreatedPageTypes: PageType[] = [
  PageType.agent,
  PageType.help,
  PageType.guide,
  PageType.add,
];
export function isMainWindowPage(pageType: PageType | undefined): boolean {
  if (!pageType) return false;
  return defaultCreatedPageTypes.includes(pageType) ||
    pageType === PageType.wiki;
}
