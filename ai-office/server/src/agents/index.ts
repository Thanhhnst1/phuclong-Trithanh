import type { AgentImpl } from './types.js';
import type { Task } from '../core/types.js';
import { planner } from './orchestrator.js';
import { researcher } from './researcher.js';
import { factchecker } from './factchecker.js';
import { editor } from './editor.js';
import { writer } from './writer.js';
import { publisher } from './publishers.js';
import { metricsCollector, reporter } from './reporter.js';

/** Resolve the implementation for a task. Step key wins for multi-role agents (orchestrator, reporter). */
export function implFor(task: Pick<Task, 'agent' | 'stepKey' | 'platform'>): AgentImpl {
  if (task.stepKey === 'metrics') return metricsCollector;
  if (task.stepKey === 'report') return reporter;
  switch (task.agent) {
    case 'orchestrator': return planner;
    case 'researcher': return researcher;
    case 'factchecker': return factchecker;
    case 'editor': return editor;
    case 'writer': return writer;
    case 'zalo': case 'facebook': case 'tiktok': case 'threads': return publisher(task.agent);
    case 'reporter': return reporter;
  }
}

/** Test hook to replace agent implementations. */
export const overrides = new Map<string, AgentImpl>();
export const resolveImpl = (t: Task) => overrides.get(t.stepKey) ?? implFor(t);
