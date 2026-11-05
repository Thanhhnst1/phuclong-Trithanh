import { EventEmitter } from 'node:events';
import type { AgentId } from './types.js';

/**
 * In-process event bus. Every state change the UI cares about goes through here and
 * is forwarded to browsers over Server-Sent Events (see routes/events.ts).
 * To scale to several server processes, replace with Redis pub/sub behind the same API.
 */
export type BusEvent =
  | { type: 'agent'; agent: AgentId; state: AgentLiveState }
  | { type: 'task'; campaignId: string; taskId: string; status: string; progress: number; message: string | null; agent: string }
  | { type: 'campaign'; campaignId: string; status: string }
  | { type: 'log'; log: any }
  | { type: 'handoff'; campaignId: string; from: AgentId; to: AgentId; label: string }
  | { type: 'content'; campaignId: string }
  | { type: 'publication'; campaignId: string };

export interface AgentLiveState {
  status: 'idle' | 'working' | 'waiting' | 'done' | 'error';
  message: string;
  campaignId: string | null;
  taskId: string | null;
  progress: number;
  updatedAt: string;
}

class Bus extends EventEmitter {
  publish(e: BusEvent) {
    this.emit('event', e);
  }
}
export const bus = new Bus();
bus.setMaxListeners(1000);
