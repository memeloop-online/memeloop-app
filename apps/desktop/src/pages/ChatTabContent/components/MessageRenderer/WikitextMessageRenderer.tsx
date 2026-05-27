/**
 * Markdown-like Message Renderer
 *
 * Renders plain text and simple markdown content.
 * Falls back to pre-formatted text.
 * Supports streaming: partial content shows with reduced opacity, final content is fully opaque.
 */
import { useAgentChatStore } from '@/pages/Agent/store/agentChatStore';
import { Box, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import React, { memo } from 'react';
import { MessageRendererProps } from './types';

const TextWrapper = styled(Box)<{ $isStreaming?: boolean }>`
  width: 100%;
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
  transition: opacity 0.3s ease;
  opacity: ${props => props.$isStreaming ? 0.7 : 1};

  & p { margin: 0.3em 0; }
  & ul, & ol { margin: 0.3em 0; padding-left: 1.5em; }
  & li { margin: 0.15em 0; }

  & pre {
    background: ${props => props.theme.palette.action.hover};
    padding: 0.5em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.9em;
  }
  & code {
    background: ${props => props.theme.palette.action.hover};
    padding: 0.1em 0.3em;
    border-radius: 2px;
    font-size: 0.9em;
  }
  & pre code { background: none; padding: 0; }

  & blockquote {
    border-left: 3px solid ${props => props.theme.palette.divider};
    margin: 0.3em 0;
    padding: 0.3em 0.8em;
    color: ${props => props.theme.palette.text.secondary};
  }

  & a { color: ${props => props.theme.palette.primary.main}; }
`;

const FallbackText = styled(Typography)`
  white-space: pre-wrap;
`;

/**
 * Simple text renderer for agent output.
 */
export const WikitextMessageRenderer: React.FC<MessageRendererProps> = memo(({ message }) => {
  const isStreaming = useAgentChatStore(state => state.isMessageStreaming(message.id));
  const content = message.content || '';

  return (
    <TextWrapper $isStreaming={isStreaming}>
      <FallbackText variant='body1'>{content}</FallbackText>
    </TextWrapper>
  );
});

WikitextMessageRenderer.displayName = 'WikitextMessageRenderer';
