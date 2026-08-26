/**
 * Type-only compatibility for historical, unreachable renderer modules.
 * None of these services are instantiated, proxied or exposed at runtime.
 * Delete this shape as the remaining inherited source files are removed.
 */
import type { IAuthenticationService } from '@services/auth/interface';
import type { IGitService } from '@services/git/interface';
import type { IHtmlWikiService } from '@services/htmlWiki/interface';
import type { IMemeloopNodeService } from '@services/memeloopNode/interface';
import type { IMenuService } from '@services/menu/interface';
import type { ISyncService } from '@services/sync/interface';
import type { IViewService } from '@services/view/interface';
import type { IWikiService } from '@services/wiki/interface';
import type { IWikiEmbeddingService } from '@services/wikiEmbedding/interface';
import type { IWikiGitWorkspaceService } from '@services/wikiGitWorkspace/interface';
import type { IWorkspaceService } from '@services/workspaces/interface';
import type { IWorkspaceViewService } from '@services/workspacesView/interface';
import type { AsyncifyProxy } from 'electron-ipc-cat/common';

export type LegacyServiceTypes = {
  auth: IAuthenticationService;
  git: IGitService;
  htmlWiki: AsyncifyProxy<IHtmlWikiService>;
  memeloopNode: IMemeloopNodeService;
  menu: IMenuService;
  sync: ISyncService;
  view: AsyncifyProxy<IViewService>;
  wiki: AsyncifyProxy<IWikiService>;
  wikiEmbedding: AsyncifyProxy<IWikiEmbeddingService>;
  wikiGitWorkspace: AsyncifyProxy<IWikiGitWorkspaceService>;
  workspace: AsyncifyProxy<IWorkspaceService>;
  workspaceView: AsyncifyProxy<IWorkspaceViewService>;
};
