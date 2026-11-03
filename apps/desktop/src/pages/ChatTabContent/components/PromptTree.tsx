import { Box, styled, Typography } from '@mui/material';
import { IPrompt } from '@services/agentInstance/promptConcat/promptConcatSchema';
import React, { memo } from 'react';

const TreeItem = styled(Box, {
  shouldForwardProp: (property: string) => property !== 'depth',
})<{ depth: number }>(({ theme, depth }) => ({
  padding: theme.spacing(1.5),
  margin: `${depth * 8}px 0 0 ${depth * 16}px`,
  borderLeft: `2px solid ${theme.palette.primary.main}`,
  background: theme.palette.background.default,
  borderRadius: Number(theme.shape.borderRadius) / 2,
  cursor: 'pointer',
  '&:active': {
    transform: 'scale(0.98)',
    background: theme.palette.action.selected,
    transition: theme.transitions.create(['transform', 'background-color'], {
      duration: theme.transitions.duration.shorter,
    }),
  },
}));

const EmptyState = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: 240,
  color: theme.palette.text.secondary,
  '& > svg': {
    fontSize: 48,
    marginBottom: theme.spacing(2),
    opacity: 0.5,
  },
}));

/**
 * Prompt tree node component for nested display
 * Memoized to prevent unnecessary re-renders
 */
export const PromptTreeNode = memo(({
  node,
  depth,
  fieldPath = [],
  onNavigate,
}: {
  node: IPrompt;
  depth: number;
  fieldPath?: string[];
  onNavigate?: (fieldPath: string[]) => void;
}): React.ReactElement => {
  if (node.enabled === false) {
    return <></>;
  }

  const handleNodeClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    const targetFieldPath = (node.source && node.source.length > 0) ? node.source : [...fieldPath, node.id];
    onNavigate?.(targetFieldPath);
  };

  return (
    <TreeItem
      depth={depth}
      onClick={handleNodeClick}
      sx={{ cursor: onNavigate ? 'pointer' : 'default' }}
    >
      <Typography variant='subtitle2' color='primary' gutterBottom>
        {node.caption || node.id || 'Prompt'}
      </Typography>
      {node.text && (
        <Typography
          variant='body2'
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            mb: node.children?.length ? 2 : 0,
          }}
        >
          {node.text}
        </Typography>
      )}
      {node.children && node.children.length > 0 && node.children.map((child: IPrompt) => {
        const childFieldPath = [...fieldPath, child.id];
        return (
          <PromptTreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            fieldPath={childFieldPath}
            onNavigate={onNavigate}
          />
        );
      })}
    </TreeItem>
  );
});
PromptTreeNode.displayName = 'PromptTreeNode';

/**
 * Prompt tree component
 * Memoized to prevent unnecessary re-renders
 */
export const PromptTree = memo(({
  prompts,
  onNavigate,
}: {
  prompts?: IPrompt[];
  onNavigate?: (fieldPath: string[]) => void;
}): React.ReactElement => {
  if (!prompts?.length) {
    return <EmptyState>No prompt tree to display</EmptyState>;
  }

  const enabledPrompts = prompts.filter((prompt) => prompt.enabled !== false);

  return (
    <Box>
      {enabledPrompts.map((item) => {
        const fieldPath = ['prompts', item.id];
        return <PromptTreeNode key={item.id} node={item} depth={0} fieldPath={fieldPath} onNavigate={onNavigate} />;
      })}
    </Box>
  );
});
PromptTree.displayName = 'PromptTree';
