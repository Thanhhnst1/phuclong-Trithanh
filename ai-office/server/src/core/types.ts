export type Role = 'admin' | 'editor' | 'viewer';

export type AgentId =
  | 'orchestrator'
  | 'researcher'
  | 'collector'
  | 'editor'
  | 'writer'
  | 'zalo'
  | 'facebook'
  | 'tiktok'
  | 'threads'
  | 'reporter';

export type Platform = 'zalo' | 'facebook' | 'tiktok' | 'threads';
export const PLATFORMS: Platform[] = ['zalo', 'facebook', 'tiktok', 'threads'];

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'blocked';

export const TERMINAL_TASK: TaskStatus[] = ['succeeded', 'failed', 'cancelled', 'skipped', 'blocked'];

/** How a result was produced. Simulated results must never be shown as real successes. */
export type ResultKind = 'real' | 'simulated' | 'manual' | 'ai' | 'none';

export type RunMode = 'demo' | 'production';

export interface WorkflowStep {
  key: string;
  agent: AgentId;
  title: string;
  deps: string[];
  /** 'success' (default): every dep must succeed/skip. 'settled': run once deps reach any terminal state. */
  depMode?: 'success' | 'settled';
  type?: 'agent' | 'approval';
  platform?: Platform;
  enabled?: boolean;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Agent to hand the task to after the primary agent exhausts its retries. */
  fallbackAgent?: AgentId;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  builtin: boolean;
}

export interface CampaignPlan {
  title: string;
  product: string;
  goalSummary: string;
  platforms: Platform[];
  audience: string;
  tone: string;
  keyMessages: string[];
  headline: string;
  searchKeywords: string[];
  generatedBy: ResultKind;
}

export interface Campaign {
  id: string;
  title: string;
  goal: string;
  workflowId: string;
  platforms: Platform[];
  status: CampaignStatus;
  mode: RunMode;
  plan: CampaignPlan | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  publishAt: string | null;
}

export interface Task {
  id: string;
  campaignId: string;
  stepKey: string;
  agent: AgentId;
  title: string;
  type: 'agent' | 'approval';
  platform: Platform | null;
  status: TaskStatus;
  deps: string[];
  depMode: 'success' | 'settled';
  output: any;
  resultKind: ResultKind | null;
  progress: number;
  message: string | null;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  fallbackAgent: AgentId | null;
  error: string | null;
  runAfter: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  seq: number;
}

export interface Asset {
  id: string;
  campaignId: string | null;
  kind: 'image' | 'video' | 'audio' | 'document' | 'report';
  role: 'source' | 'edited' | 'logo' | 'report';
  path: string; // relative to media root
  mime: string;
  width: number | null;
  height: number | null;
  hash: string | null;
  source: string;
  license: string;
  label: string;
  derivedFrom: string | null;
  meta: any;
  createdAt: string;
}

export interface ContentVariant {
  id: string;
  campaignId: string;
  platform: Platform;
  variant: number;
  title: string;
  body: string;
  hashtags: string[];
  cta: string;
  mediaIds: string[];
  status: 'draft' | 'approved' | 'rejected';
  resultKind: ResultKind;
  approvedBy: string | null;
  approvedAt: string | null;
}

export type PublicationStatus =
  | 'published'
  | 'draft_uploaded'
  | 'simulated'
  | 'manual_pending'
  | 'manual_done'
  | 'failed';

export interface Publication {
  id: string;
  campaignId: string;
  platform: Platform;
  contentId: string | null;
  mode: 'real' | 'simulated' | 'manual';
  status: PublicationStatus;
  externalId: string | null;
  url: string | null;
  error: string | null;
  response: any;
  metrics: any;
  createdAt: string;
  updatedAt: string;
}

export class RetryableError extends Error {
  retryable = true;
}
export class FatalError extends Error {
  retryable = false;
}
