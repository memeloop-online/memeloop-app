/**
 * Canonical AgentInstance/ChatMessage construction and the one SQL projection
 * boundary used by the desktop repository.
 */
import {
  type AgentDefinition,
  type AgentInstanceLatestStatus,
  type AgentInstanceMetadata,
  type AgentInstanceModel,
  type ChatMessage,
  createAgentInstanceFromDefinition,
  createChatMessage,
} from 'memeloop';
import { nanoid } from 'nanoid';

import type { AgentInstanceEntity, AgentInstanceMessageEntity } from '@services/database/schema/agent';

export interface AgentInstanceCreationOptions {
  preview?: boolean;
  volatile?: boolean;
}

/** Create a full Core execution model through Core's factory. */
export function createAgentInstanceData(
  agentDefinition: AgentDefinition,
  options: AgentInstanceCreationOptions = {},
): {
  instanceData: AgentInstanceModel;
  instanceId: string;
  now: Date;
} {
  const instanceId = nanoid();
  const instanceData = createAgentInstanceFromDefinition(agentDefinition, {
    id: instanceId,
    volatile: options.preview || options.volatile,
    closed: false,
  });
  return { instanceData, instanceId, now: instanceData.created };
}

/** Create a canonical message; provenance is supplied by the host, not invented here. */
export function createAgentMessage(
  input: {
    messageId: string;
    turnId: string;
    conversationId: string;
    role: ChatMessage['role'];
    content?: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
    duration?: number | null;
    originNodeId: string;
    originSequence: number;
    timestamp: number;
    lamportClock: number;
    parts?: ChatMessage['parts'];
  },
): ChatMessage {
  return createChatMessage(input);
}

/** Map a durable SQL message row to the canonical Core message contract. */
export function projectAgentMessage(entity: AgentInstanceMessageEntity): ChatMessage {
  if (!entity.id || !entity.agentId || !entity.turnId || !entity.originNodeId) {
    throw new Error('agent_message_missing_identity');
  }
  const originSequence = entity.originSequence;
  const lamportClock = entity.lamportClock;
  if (typeof originSequence !== 'number' || !Number.isSafeInteger(originSequence) || originSequence < 0) {
    throw new Error('agent_message_invalid_origin_sequence');
  }
  if (typeof lamportClock !== 'number' || !Number.isSafeInteger(lamportClock) || lamportClock < 0) {
    throw new Error('agent_message_invalid_lamport_clock');
  }
  if (!entity.created || !Number.isFinite(entity.created.getTime()) || !Array.isArray(entity.parts)) {
    throw new Error('agent_message_missing_canonical_payload');
  }
  return {
    messageId: entity.id,
    turnId: entity.turnId,
    conversationId: entity.agentId,
    originNodeId: entity.originNodeId,
    originSequence,
    timestamp: entity.created.getTime(),
    lamportClock,
    role: entity.role,
    parts: entity.parts,
    content: entity.content,
    ...(entity.contentType === undefined ? {} : { contentType: entity.contentType }),
    ...(entity.toolCalls === undefined ? {} : { toolCalls: entity.toolCalls }),
    ...(entity.attachments === undefined ? {} : { attachments: entity.attachments }),
    ...(entity.detailRef === undefined ? {} : { detailRef: entity.detailRef }),
    ...(entity.reasoning_content === undefined ? {} : { reasoning_content: entity.reasoning_content }),
    ...(entity.hidden ? { hidden: true } : {}),
    ...(entity.metadata === undefined ? {} : { metadata: entity.metadata }),
    ...(entity.duration === undefined ? {} : { duration: entity.duration }),
  };
}

/** Map a canonical message to the physical SQL columns exactly once. */
export function toDatabaseCompatibleMessage(message: ChatMessage): Partial<AgentInstanceMessageEntity> {
  return {
    id: message.messageId,
    agentId: message.conversationId,
    turnId: message.turnId,
    originNodeId: message.originNodeId,
    lamportClock: message.lamportClock,
    originSequence: message.originSequence,
    role: message.role,
    content: message.content,
    parts: message.parts,
    toolCalls: message.toolCalls,
    attachments: message.attachments,
    detailRef: message.detailRef,
    reasoning_content: message.reasoning_content,
    hidden: message.hidden,
    contentType: message.contentType,
    metadata: message.metadata,
    created: new Date(message.timestamp),
    duration: message.duration === null ? undefined : message.duration,
  };
}

/** Map a full model to physical instance columns; messages are persisted separately. */
export function toDatabaseCompatibleInstance(
  instance: AgentInstanceModel,
  options: { preview?: boolean } = {},
): Partial<AgentInstanceEntity> {
  return {
    id: instance.id,
    agentDefId: instance.agentDefId,
    name: instance.name,
    status: instance.status,
    modelConfig: instance.modelConfig,
    avatarUrl: instance.avatarUrl,
    agentFrameworkConfig: instance.agentFrameworkConfig,
    closed: instance.closed,
    volatile: instance.volatile,
    preview: options.preview ?? false,
  };
}

/** Project bounded metadata without joining or fabricating a message array. */
export function projectAgentInstanceMetadata(entity: AgentInstanceEntity): AgentInstanceMetadata {
  if (!entity.id || !entity.agentDefId || !entity.created || !entity.status) {
    throw new Error('agent_instance_missing_metadata');
  }
  return {
    id: entity.id,
    agentDefId: entity.agentDefId,
    ...(entity.name === undefined ? {} : { name: entity.name }),
    status: entity.status,
    created: entity.created,
    ...(entity.modified === undefined ? {} : { modified: entity.modified }),
    ...(entity.modelConfig === undefined ? {} : { modelConfig: entity.modelConfig }),
    ...(entity.avatarUrl === undefined ? {} : { avatarUrl: entity.avatarUrl }),
    ...(entity.agentFrameworkConfig === undefined ? {} : { agentFrameworkConfig: entity.agentFrameworkConfig }),
    closed: entity.closed,
    volatile: entity.volatile,
    preview: entity.preview,
  };
}

/** Update shape accepted by the metadata persistence adapter. */
export function toMetadataUpdate(
  update: Partial<Pick<AgentInstanceMetadata, 'name' | 'status' | 'modelConfig' | 'avatarUrl' | 'agentFrameworkConfig' | 'closed'>>,
): Partial<AgentInstanceEntity> {
  return {
    ...(update.name === undefined ? {} : { name: update.name }),
    ...(update.status === undefined ? {} : { status: update.status }),
    ...(update.modelConfig === undefined ? {} : { modelConfig: update.modelConfig }),
    ...(update.avatarUrl === undefined ? {} : { avatarUrl: update.avatarUrl }),
    ...(update.agentFrameworkConfig === undefined ? {} : { agentFrameworkConfig: update.agentFrameworkConfig }),
    ...(update.closed === undefined ? {} : { closed: update.closed }),
  };
}

/** Canonical fields used by callers that need a compile-time status value. */
export type AgentInstanceStatus = AgentInstanceLatestStatus;
