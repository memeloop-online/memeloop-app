/**
 * ITerminalSessionManager: start/manage long-running commands, stream stdout/stderr,
 * stdin write, interaction detection (timeout + regex prompt), process lifecycle, session list.
 *
 * Implementation is adapted from memeloop-cli's terminal module for the standalone App.
 */

import { logger } from '@services/libs/log';
import { AGENT_SESSION_CONTRACT_LIMITS } from 'memeloop';
import { type ChildProcess, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { TerminalFollowResult, TerminalInteractionPrompt, TerminalOutputChunk, TerminalSessionInfo, TerminalSessionStatus } from './types';

export interface StartSessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Regex patterns to detect "prompt" (e.g. ">$ ", "Password:") for interaction detection.
   */
  promptPatterns?: { name: string; regex: RegExp }[];
  /**
   * If no output for this many ms, emit interaction prompt (optional).
   * (For typical interactive prompts, promptPatterns are still required.)
   */
  idleTimeoutMs?: number;
}

export interface ITerminalSessionManager {
  start(options: StartSessionOptions): Promise<{ sessionId: string }>;
  list(): Promise<TerminalSessionInfo[]>;
  get(sessionId: string): TerminalSessionInfo | undefined;
  respond(sessionId: string, input: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  signal(sessionId: string, signal: NodeJS.Signals): Promise<void>;
  getOutputText(
    sessionId: string,
    options?: { tailLines?: number; tailChars?: number; maxBytes?: number },
  ): string;
  follow(
    sessionId: string,
    options?: TerminalOutputPageOptions & { untilExit?: boolean; maxWaitMs?: number },
  ): Promise<TerminalFollowResult>;
  getChunksSince(
    sessionId: string,
    fromSeq?: number,
    options?: TerminalOutputPageOptions,
  ): TerminalOutputChunk[];
  onOutput(listener: (chunk: TerminalOutputChunk) => void): () => void;
  onStatusUpdate(
    listener: (update: {
      sessionId: string;
      status: TerminalSessionStatus;
      exitCode: number | null;
      ts: number;
    }) => void,
  ): () => void;
  onInteractionPrompt(
    listener: (prompt: TerminalInteractionPrompt) => void,
  ): () => void;
  onSessionComplete(
    listener: (
      sessionId: string,
      info: TerminalSessionInfo,
      truncatedOutput: string,
    ) => void,
  ): () => void;
}

export interface TerminalOutputPageOptions {
  /** Hard maximum number of chunks returned by a follow/page call. */
  limit?: number;
  /** Hard UTF-8 response budget for a follow/page call. */
  maxBytes?: number;
}

interface SessionState {
  sessionId: string;
  command: string;
  cwd: string;
  status: TerminalSessionStatus;
  exitCode: number | null;
  startedAt: number;
  process: ChildProcess;
  idleTimer?: ReturnType<typeof setTimeout>;
  promptPatterns?: { name: string; regex: RegExp }[];
  idleTimeoutMs?: number;
  buffer: string;
  rollingOutput: string;
  retainedOutputBytes: number;
  chunks: TerminalOutputChunk[];
  nextSeq: number;
  exitedAt?: number;
}

export class TerminalSessionManager extends EventEmitter implements ITerminalSessionManager {
  private sessions = new Map<string, SessionState>();
  private outputListeners = new Set<(chunk: TerminalOutputChunk) => void>();
  private statusListeners = new Set<
    (update: {
      sessionId: string;
      status: TerminalSessionStatus;
      exitCode: number | null;
      ts: number;
    }) => void
  >();
  private promptListeners = new Set<
    (prompt: TerminalInteractionPrompt) => void
  >();
  private sessionCompleteListeners = new Set<
    (
      sessionId: string,
      info: TerminalSessionInfo,
      truncatedOutput: string,
    ) => void
  >();
  private readonly maxChunksPerSession: number;
  private readonly maxChunkBytes: number;
  private readonly maxRollingOutputBytes: number;
  private readonly maxInputBytes: number;

  constructor(options?: {
    maxChunksPerSession?: number;
    maxChunkBytes?: number;
    maxRollingOutputBytes?: number;
    maxInputBytes?: number;
  }) {
    super();
    this.maxChunksPerSession = Math.max(1, options?.maxChunksPerSession ?? 4000);
    this.maxRollingOutputBytes = Math.max(
      1,
      options?.maxRollingOutputBytes ?? AGENT_SESSION_CONTRACT_LIMITS.responseBytes,
    );
    this.maxChunkBytes = Math.max(
      1,
      Math.min(
        options?.maxChunkBytes ?? AGENT_SESSION_CONTRACT_LIMITS.projectionPageDefaultBytes,
        this.maxRollingOutputBytes,
      ),
    );
    this.maxInputBytes = Math.max(
      1,
      options?.maxInputBytes ?? AGENT_SESSION_CONTRACT_LIMITS.messageProjectionBytes,
    );
  }

  async start(options: StartSessionOptions): Promise<{ sessionId: string }> {
    const sessionId = crypto.randomUUID();
    const cwd = options.cwd ?? process.cwd();
    const arguments_ = options.args ?? [];
    const environment = { ...process.env, ...options.env };

    const proc = spawn(options.command, arguments_, {
      cwd,
      env: environment,
      // Keep command and args as separate argv entries; shell parsing would
      // reintroduce injection and escaping ambiguity at the process boundary.
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const state: SessionState = {
      sessionId,
      command: [options.command, ...arguments_].join(' '),
      cwd,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      process: proc,
      promptPatterns: options.promptPatterns,
      idleTimeoutMs: options.idleTimeoutMs,
      buffer: '',
      rollingOutput: '',
      retainedOutputBytes: 0,
      chunks: [],
      nextSeq: 1,
    };

    this.sessions.set(sessionId, state);

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.pushOutput(sessionId, 'stdout', text, state);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.pushOutput(sessionId, 'stderr', text, state);
    });

    proc.on('exit', (code, signal) => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      s.status = signal ? 'killed' : 'exited';
      s.exitCode = code;
      s.exitedAt = Date.now();
      if (s.idleTimer) clearTimeout(s.idleTimer);
      this.emitSessionComplete(s);
      this.emitStatusUpdate(sessionId, s.status, s.exitCode);
    });

    proc.on('error', (error: Error) => {
      const s = this.sessions.get(sessionId);
      if (s) {
        s.status = 'failed';
        s.exitedAt = Date.now();
        this.emitSessionComplete(s);
        this.emitStatusUpdate(sessionId, s.status, s.exitCode);
      }
      logger.warn('Terminal session process failed', { sessionId, error });
    });

    if (options.idleTimeoutMs) {
      this.scheduleIdlePrompt(sessionId, state);
    }

    return { sessionId };
  }

  private pushOutput(
    sessionId: string,
    stream: 'stdout' | 'stderr',
    text: string,
    state: SessionState,
  ): void {
    for (const piece of splitUtf8(text, this.maxChunkBytes)) {
      this.pushOutputChunk(sessionId, stream, piece, state);
    }
  }

  private pushOutputChunk(
    sessionId: string,
    stream: 'stdout' | 'stderr',
    text: string,
    state: SessionState,
  ): void {
    const seq = state.nextSeq++;
    const ts = Date.now();
    const chunk: TerminalOutputChunk = { sessionId, seq, stream, data: text, ts };

    state.chunks.push(chunk);
    state.retainedOutputBytes += utf8Bytes(text);
    while (
      state.chunks.length > this.maxChunksPerSession ||
      state.retainedOutputBytes > this.maxRollingOutputBytes
    ) {
      const removed = state.chunks.shift();
      if (!removed) break;
      state.retainedOutputBytes -= utf8Bytes(removed.data);
    }

    for (const function_ of this.outputListeners) function_(chunk);

    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }

    state.rollingOutput = appendRollingTail(
      state.rollingOutput,
      text,
      this.maxRollingOutputBytes,
    );
    state.buffer = appendRollingTail(
      state.buffer,
      text,
      Math.min(this.maxRollingOutputBytes, 64 * 1024),
    );

    if (state.promptPatterns?.length) {
      for (const { name, regex } of state.promptPatterns) {
        if (regex.test(state.buffer)) {
          const prompt: TerminalInteractionPrompt = {
            sessionId,
            promptText: state.buffer.slice(-200),
            patternName: name,
            timestamp: ts,
          };
          for (const function_ of this.promptListeners) function_(prompt);
          state.buffer = '';
          break;
        }
      }
    }

    if (state.idleTimeoutMs) {
      this.scheduleIdlePrompt(sessionId, state);
    }
  }

  private scheduleIdlePrompt(sessionId: string, state: SessionState): void {
    if (state.status !== 'running' || !state.idleTimeoutMs) return;
    state.idleTimer = setTimeout(() => {
      state.idleTimer = undefined;
      const prompt: TerminalInteractionPrompt = {
        sessionId,
        promptText: state.buffer || '(no output yet)',
        timestamp: Date.now(),
      };
      for (const function_ of this.promptListeners) function_(prompt);
    }, state.idleTimeoutMs);
  }

  async list(): Promise<TerminalSessionInfo[]> {
    return Array.from(this.sessions.values()).map((s) => this.toInfo(s));
  }

  get(sessionId: string): TerminalSessionInfo | undefined {
    const s = this.sessions.get(sessionId);
    return s ? this.toInfo(s) : undefined;
  }

  getChunksSince(
    sessionId: string,
    fromSeq = 1,
    options?: TerminalOutputPageOptions,
  ): TerminalOutputChunk[] {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    return selectOutputPage(
      s.chunks.filter((c) => c.seq >= fromSeq),
      options,
    );
  }

  private toInfo(s: SessionState): TerminalSessionInfo {
    return {
      sessionId: s.sessionId,
      command: s.command,
      cwd: s.cwd,
      status: s.status,
      exitCode: s.exitCode,
      startedAt: s.startedAt,
      exitedAt: s.exitedAt,
    };
  }

  async respond(sessionId: string, input: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    if (s.status !== 'running' || !s.process.stdin?.writable) {
      throw new Error(`Session not writable: ${sessionId}`);
    }
    if (utf8Bytes(input + '\n') > this.maxInputBytes) {
      throw new RangeError(`terminal input exceeds ${this.maxInputBytes} bytes`);
    }
    s.process.stdin.write(input + '\n');
  }

  async cancel(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.idleTimer) {
      clearTimeout(s.idleTimer);
      s.idleTimer = undefined;
    }
    try {
      s.process.kill('SIGTERM');
    } catch (error) {
      // The child may have exited between lookup and cancellation. Keep the
      // lifecycle transition deterministic, but retain the diagnostic.
      logger.debug('Terminal session was already gone during cancellation', { sessionId, error });
    }
    s.status = 'killed';
    s.exitedAt = Date.now();
    this.emitStatusUpdate(sessionId, s.status, s.exitCode);
  }

  async follow(
    sessionId: string,
    options?: TerminalOutputPageOptions & { fromSeq?: number; untilExit?: boolean; maxWaitMs?: number },
  ): Promise<TerminalFollowResult> {
    const fromSeq = Math.max(1, options?.fromSeq ?? 1);
    const untilExit = options?.untilExit === true;
    const maxWaitMs = options?.maxWaitMs ?? 30_000;
    const maxUntil = maxWaitMs > 0 ? Date.now() + maxWaitMs : Number.POSITIVE_INFINITY;

    while (true) {
      const state = this.sessions.get(sessionId);
      if (!state) throw new Error(`Session not found: ${sessionId}`);

      const chunks = selectOutputPage(
        state.chunks.filter((chunk) => chunk.seq >= fromSeq),
        options,
      );
      const done = state.status !== 'running';

      if (!untilExit || done || chunks.length > 0 || Date.now() >= maxUntil) {
        return {
          sessionId,
          status: state.status,
          exitCode: state.exitCode,
          nextSeq: state.nextSeq,
          done,
          chunks,
        };
      }

      await this.waitForFollowEvent(sessionId, maxUntil);
    }
  }

  /**
   * Wait for the next output/status transition instead of polling on a fixed
   * interval. The timeout remains bounded by the caller's maxWaitMs and is
   * only used when no process event arrives before the deadline.
   */
  private waitForFollowEvent(sessionId: string, deadline: number): Promise<void> {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let unsubscribeOutput = (): void => undefined;
      let unsubscribeStatus = (): void => undefined;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsubscribeOutput();
        unsubscribeStatus();
        resolve();
      };

      unsubscribeOutput = this.onOutput(chunk => {
        if (chunk.sessionId === sessionId) finish();
      });
      unsubscribeStatus = this.onStatusUpdate(update => {
        if (update.sessionId === sessionId) finish();
      });

      const state = this.sessions.get(sessionId);
      if (!state || state.status !== 'running') {
        finish();
        return;
      }

      if (Number.isFinite(deadline)) {
        timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
      }
    });
  }

  onOutput(listener: (chunk: TerminalOutputChunk) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onStatusUpdate(
    listener: (update: {
      sessionId: string;
      status: TerminalSessionStatus;
      exitCode: number | null;
      ts: number;
    }) => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onInteractionPrompt(
    listener: (prompt: TerminalInteractionPrompt) => void,
  ): () => void {
    this.promptListeners.add(listener);
    return () => this.promptListeners.delete(listener);
  }

  signal(sessionId: string, signal: NodeJS.Signals): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== 'running') return Promise.resolve();
    try {
      s.process.kill(signal);
    } catch (error) {
      // Signal delivery is best effort once the process has exited, but retain
      // the diagnostic so a failed cancellation is not silently swallowed.
      logger.debug('Terminal session signal delivery failed', { sessionId, signal, error });
    }
    return Promise.resolve();
  }

  getOutputText(
    sessionId: string,
    options?: { tailLines?: number; tailChars?: number; maxBytes?: number },
  ): string {
    const s = this.sessions.get(sessionId);
    if (!s) return '';
    let fullText = s.rollingOutput;
    if (typeof options?.maxBytes === 'number') {
      fullText = sliceUtf8Suffix(fullText, Math.max(1, options.maxBytes));
    }
    if (options?.tailChars) {
      return fullText.slice(-options.tailChars);
    }
    if (options?.tailLines) {
      const lines = fullText.split('\n');
      return lines.slice(-options.tailLines).join('\n');
    }
    return fullText;
  }

  onSessionComplete(
    listener: (
      sessionId: string,
      info: TerminalSessionInfo,
      truncatedOutput: string,
    ) => void,
  ): () => void {
    this.sessionCompleteListeners.add(listener);
    return () => this.sessionCompleteListeners.delete(listener);
  }

  private emitStatusUpdate(
    sessionId: string,
    status: TerminalSessionStatus,
    exitCode: number | null,
  ): void {
    const payload = { sessionId, status, exitCode, ts: Date.now() };
    for (const function_ of this.statusListeners) function_(payload);
  }

  private emitSessionComplete(state: SessionState): void {
    const info = this.toInfo(state);
    const output = truncateOutput(state.rollingOutput, 8 * 1024);
    for (const function_ of this.sessionCompleteListeners) {
      try {
        function_(state.sessionId, info, output);
      } catch (error) {
        // Completion listeners must not break process lifecycle notifications,
        // but listener failures should remain diagnosable.
        logger.warn('Terminal session completion listener failed', {
          sessionId: state.sessionId,
          error,
        });
      }
    }
  }
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function splitUtf8(value: string, maximumBytes: number): string[] {
  if (!value) return [''];
  const pieces: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of value) {
    const characterBytes = utf8Bytes(character);
    if (current && currentBytes + characterBytes > maximumBytes) {
      pieces.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) pieces.push(current);
  return pieces;
}

function appendRollingTail(current: string, addition: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return '';
  return sliceUtf8Suffix(current + addition, maximumBytes);
}

function sliceUtf8Suffix(value: string, maximumBytes: number): string {
  if (utf8Bytes(value) <= maximumBytes) return value;
  let bytes = 0;
  const characters: string[] = [];
  const codePoints = Array.from(value);
  for (let index = codePoints.length - 1; index >= 0; index -= 1) {
    const character = codePoints[index];
    const characterBytes = utf8Bytes(character);
    if (bytes + characterBytes > maximumBytes) break;
    characters.push(character);
    bytes += characterBytes;
  }
  return characters.reverse().join('');
}

function sliceUtf8Prefix(value: string, maximumBytes: number): string {
  if (utf8Bytes(value) <= maximumBytes) return value;
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = utf8Bytes(character);
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function selectOutputPage(
  chunks: TerminalOutputChunk[],
  options?: TerminalOutputPageOptions,
): TerminalOutputChunk[] {
  validateOutputPageOptions(options);
  const limit = typeof options?.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : Number.POSITIVE_INFINITY;
  const maxBytes = typeof options?.maxBytes === 'number' ? Math.max(1, Math.floor(options.maxBytes)) : Number.POSITIVE_INFINITY;
  const selected: TerminalOutputChunk[] = [];
  let bytes = 0;
  for (const chunk of chunks) {
    if (selected.length >= limit) break;
    const available = maxBytes - bytes;
    if (available <= 0) break;
    const data = utf8Bytes(chunk.data) > available ? sliceUtf8Prefix(chunk.data, available) : chunk.data;
    if (!data) break;
    selected.push(data === chunk.data ? chunk : { ...chunk, data });
    bytes += utf8Bytes(data);
    if (data !== chunk.data) break;
  }
  return selected;
}

function validateOutputPageOptions(options?: TerminalOutputPageOptions): void {
  if (
    options?.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > AGENT_SESSION_CONTRACT_LIMITS.turnDetailPage)
  ) {
    throw new RangeError(`terminal page limit must be between 1 and ${AGENT_SESSION_CONTRACT_LIMITS.turnDetailPage}`);
  }
  if (
    options?.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > AGENT_SESSION_CONTRACT_LIMITS.responseBytes)
  ) {
    throw new RangeError(`terminal page maxBytes must be between 1 and ${AGENT_SESSION_CONTRACT_LIMITS.responseBytes}`);
  }
}

function truncateOutput(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) return value;
  const head = 1500;
  const tail = Math.max(0, maximumCharacters - head - 40);
  return `${value.slice(0, head)}\n[... truncated ${value.length - head - tail} chars ...]\n${value.slice(-tail)}`;
}

// Singleton used by agent tools.
export const terminalSessionManager = new TerminalSessionManager();
