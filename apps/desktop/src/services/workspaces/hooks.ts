import { useState, useEffect } from 'react';
import { IWorkspaceWithMetadata } from './interface';

// Stub hook - returns empty array since workspace management is removed
export function useWorkspacesListObservable(): IWorkspaceWithMetadata[] | undefined {
  const [workspaces] = useState<IWorkspaceWithMetadata[]>([]);
  return workspaces;
}
