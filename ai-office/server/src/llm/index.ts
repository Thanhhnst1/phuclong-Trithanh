import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { vault } from '../core/vault.js';
import { settings } from '../db/index.js';

/**
 * Reasoning engine abstraction. Claude is the default implementation; any other provider
 * can be added by implementing `LLM` and returning it from `getLLM()`.
 * When no provider is configured `getLLM()` returns null and agents fall back to
 * clearly-labelled demo templates (resultKind = 'simulated').
 */
export interface ResearchResult {
  notes: string;
  sources: { title: string; url: string }[];
}

export interface McpServerConfig {
  name: string;
  url: string;
  token?: string;
}

export interface LLM {
  readonly provider: string;
  readonly model: string;
  json<T>(opts: { system: string; prompt: string; schema: Record<string, unknown>; effort?: Effort; signal?: AbortSignal }): Promise<T>;
  research(opts: { system: string; prompt: string; webSearch: boolean; mcpServers: McpServerConfig[]; signal?: AbortSignal }): Promise<ResearchResult>;
}

type Effort = 'low' | 'medium' | 'high';

export class LLMRefusalError extends Error {}

class ClaudeLLM implements LLM {
  readonly provider = 'anthropic';
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async json<T>({ system, prompt, schema, effort = 'medium', signal }: Parameters<LLM['json']>[0]): Promise<T> {
    const res = await this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort, format: { type: 'json_schema', schema } },
      },
      { signal },
    );
    if (res.stop_reason === 'refusal') throw new LLMRefusalError('Mô hình từ chối yêu cầu này');
    if (res.stop_reason === 'max_tokens') throw new Error('Phản hồi AI bị cắt (max_tokens)');
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return JSON.parse(text) as T;
  }

  async research({ system, prompt, webSearch, mcpServers, signal }: Parameters<LLM['research']>[0]): Promise<ResearchResult> {
    const tools: any[] = [];
    const betas: string[] = ['server-side-fallback-2026-07-01'];
    if (webSearch) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 6 });
    for (const s of mcpServers) tools.push({ type: 'mcp_toolset', mcp_server_name: s.name });
    if (mcpServers.length) betas.push('mcp-client-2025-11-20');

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    const sources = new Map<string, string>();
    let notes = '';
    // Server tools may pause long turns (`pause_turn`); resume a few times.
    for (let i = 0; i < 4; i++) {
      const res = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          betas,
          fallbacks: 'default',
          system,
          messages,
          tools,
          output_config: { effort: 'medium' },
          ...(mcpServers.length
            ? {
                mcp_servers: mcpServers.map((s) => ({
                  type: 'url' as const,
                  url: s.url,
                  name: s.name,
                  ...(s.token ? { authorization_token: s.token } : {}),
                })),
              }
            : {}),
        },
        { signal },
      );
      if (res.stop_reason === 'refusal') throw new LLMRefusalError('Mô hình từ chối yêu cầu nghiên cứu này');
      for (const block of res.content as any[]) {
        if (block.type === 'text') {
          notes += block.text;
          for (const c of block.citations ?? []) if (c.url) sources.set(c.url, c.title ?? c.url);
        }
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r.url) sources.set(r.url, r.title ?? r.url);
        }
      }
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content as any });
    }
    return { notes: notes.trim(), sources: [...sources].map(([url, title]) => ({ url, title })) };
  }
}

let cached: { key: string; model: string; llm: LLM } | null = null;

export function anthropicKey(): string | null {
  return vault.get('anthropic.apiKey') ?? process.env.ANTHROPIC_API_KEY ?? null;
}

export function currentModel() {
  return settings.get('llm.model') ?? config.defaultModel;
}

/** Returns the configured reasoning engine, or null when none is configured. */
export function getLLM(): LLM | null {
  if (settings.get('llm.disabled') === 'true') return null;
  const key = anthropicKey();
  if (!key) return null;
  const model = currentModel();
  if (!cached || cached.key !== key || cached.model !== model) cached = { key, model, llm: new ClaudeLLM(key, model) };
  return cached.llm;
}

/** Test hook: lets unit tests inject a fake LLM. */
let override: LLM | null | undefined;
export function setLLMOverride(l: LLM | null | undefined) {
  override = l;
}
export function resolveLLM(): LLM | null {
  return override !== undefined ? override : getLLM();
}
