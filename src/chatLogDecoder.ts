import * as fs from 'fs/promises';
import * as path from 'path';

import { ChatLogDecodeResult, SerializableChatData } from './types';

const enum MutationEntryKind {
  Initial = 0,
  Set = 1,
  Push = 2,
  Delete = 3
}

type ObjectPath = Array<string | number>;

type MutationLogEntry =
  | { kind: MutationEntryKind.Initial; v: unknown }
  | { kind: MutationEntryKind.Set; k: ObjectPath; v: unknown }
  | { kind: MutationEntryKind.Push; k: ObjectPath; v?: unknown[]; i?: number }
  | { kind: MutationEntryKind.Delete; k: ObjectPath };

type MutableContainer = Record<string, unknown> | unknown[];

export class ChatLogDecoder {
  public decodeJsonSnapshot(contents: string): SerializableChatData {
    const parsed = JSON.parse(contents) as unknown;
    if (!isPlainObject(parsed)) {
      throw new Error('Session snapshot must be a JSON object.');
    }

    return parsed as SerializableChatData;
  }

  public decodeJsonLines(contents: string): ChatLogDecodeResult<SerializableChatData> {
    let state: unknown;
    let lineCount = 0;

    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (!trimmed) {
        continue;
      }

      const lineNumber = index + 1;
      const entry = this.parseEntry(trimmed, lineNumber);
      lineCount += 1;

      try {
        switch (entry.kind) {
          case MutationEntryKind.Initial:
            state = entry.v;
            break;
          case MutationEntryKind.Set:
            this.ensureStateInitialized(state);
            this.applySet(state, entry.k, entry.v);
            break;
          case MutationEntryKind.Push:
            this.ensureStateInitialized(state);
            this.applyPush(state, entry.k, entry.v, entry.i);
            break;
          case MutationEntryKind.Delete:
            this.ensureStateInitialized(state);
            this.applySet(state, entry.k, undefined);
            break;
          default:
            throw new Error(`Unknown mutation entry kind: ${String((entry as { kind: unknown }).kind)}`);
        }
      } catch (error) {
        throw new Error(this.errorMessage(error, `Failed to apply JSONL entry at line ${lineNumber}.`));
      }
    }

    if (lineCount === 0) {
      throw new Error('Empty log file.');
    }

    if (!isPlainObject(state)) {
      throw new Error('Decoded session state must be a JSON object.');
    }

    return {
      data: state as SerializableChatData,
      lineCount
    };
  }

  private parseEntry(line: string, lineNumber: number): MutationLogEntry {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(this.errorMessage(error, `Failed to parse JSONL entry at line ${lineNumber}.`));
    }

    if (!isPlainObject(parsed) || typeof parsed.kind !== 'number') {
      throw new Error(`Invalid JSONL entry at line ${lineNumber}.`);
    }

    switch (parsed.kind) {
      case MutationEntryKind.Initial:
        return { kind: MutationEntryKind.Initial, v: parsed.v };
      case MutationEntryKind.Set:
        if (!isObjectPath(parsed.k)) {
          throw new Error(`Invalid set path at line ${lineNumber}.`);
        }

        return { kind: MutationEntryKind.Set, k: parsed.k, v: parsed.v };
      case MutationEntryKind.Push:
        if (!isObjectPath(parsed.k)) {
          throw new Error(`Invalid push path at line ${lineNumber}.`);
        }

        if (parsed.v !== undefined && !Array.isArray(parsed.v)) {
          throw new Error(`Invalid push payload at line ${lineNumber}.`);
        }

        const startIndex = readOptionalNonNegativeInteger(parsed.i);
        if (parsed.i !== undefined && startIndex === undefined) {
          throw new Error(`Invalid push start index at line ${lineNumber}.`);
        }

        return { kind: MutationEntryKind.Push, k: parsed.k, v: parsed.v, i: startIndex };
      case MutationEntryKind.Delete:
        if (!isObjectPath(parsed.k)) {
          throw new Error(`Invalid delete path at line ${lineNumber}.`);
        }

        return { kind: MutationEntryKind.Delete, k: parsed.k };
      default:
        throw new Error(`Unknown JSONL entry kind at line ${lineNumber}: ${parsed.kind}`);
    }
  }

  private ensureStateInitialized(state: unknown): asserts state is object {
    if (state === undefined) {
      throw new Error('Log file is missing an initial entry.');
    }
  }

  private applySet(state: unknown, path: ObjectPath, value: unknown): void {
    if (path.length === 0) {
      return;
    }

    const { container, key } = this.resolveParentContainer(state, path);
    setContainerValue(container, key, value);
  }

  private applyPush(state: unknown, path: ObjectPath, values: unknown[] | undefined, startIndex: number | undefined): void {
    if (path.length === 0) {
      if (!Array.isArray(state)) {
        throw new Error('Push entry cannot target the root of a non-array state.');
      }

      if (startIndex !== undefined) {
        state.length = startIndex;
      }

      if (values && values.length > 0) {
        state.push(...values);
      }

      return;
    }

    const { container, key } = this.resolveParentContainer(state, path);
    const existing = getContainerValue(container, key);

    let targetArray: unknown[];
    if (existing === undefined) {
      targetArray = [];
    } else if (Array.isArray(existing)) {
      targetArray = existing;
    } else {
      throw new Error(`Push entry targeted a non-array value at ${formatPath(path)}.`);
    }

    if (startIndex !== undefined) {
      targetArray.length = startIndex;
    }

    if (values && values.length > 0) {
      targetArray.push(...values);
    }

    setContainerValue(container, key, targetArray);
  }

  private resolveParentContainer(state: unknown, path: ObjectPath): { container: MutableContainer; key: string | number } {
    let current = state;

    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index];
      if (!isIndexable(current)) {
        throw new Error(`Mutation path ${formatPath(path)} could not be resolved.`);
      }

      current = getContainerValue(current, segment);
    }

    if (!isIndexable(current)) {
      throw new Error(`Mutation path ${formatPath(path)} could not be resolved.`);
    }

    return {
      container: current,
      key: path[path.length - 1]
    };
  }

  private errorMessage(error: unknown, prefix: string): string {
    const suffix = error instanceof Error ? error.message : String(error);
    return `${prefix} ${suffix}`;
  }
}

export async function decodeChatLogFile(
  sessionFile: string,
  decoder: ChatLogDecoder = new ChatLogDecoder()
): Promise<SerializableChatData> {
  const contents = await fs.readFile(sessionFile, 'utf8');
  const extension = path.extname(sessionFile).toLowerCase();

  if (extension === '.jsonl') {
    return decoder.decodeJsonLines(contents).data;
  }

  if (extension === '.json') {
    return decoder.decodeJsonSnapshot(contents);
  }

  throw new Error(`Unsupported session log extension: ${extension || '<none>'}`);
}

export function hasStoredRequests(data: SerializableChatData): boolean {
  return Array.isArray(data.requests) && data.requests.length > 0;
}

function formatPath(path: ObjectPath): string {
  return path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${segment}`)).join('') || '<root>';
}

function getContainerValue(container: MutableContainer, key: string | number): unknown {
  return container[key as keyof MutableContainer];
}

function setContainerValue(container: MutableContainer, key: string | number, value: unknown): void {
  (container as Record<string | number, unknown>)[key] = value;
}

function isIndexable(value: unknown): value is MutableContainer {
  return Array.isArray(value) || isPlainObject(value);
}

function isObjectPath(value: unknown): value is ObjectPath {
  return Array.isArray(value) && value.every((segment) => typeof segment === 'string' || typeof segment === 'number');
}

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
