import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOWS, resolveSteps, validateWorkflow } from '../src/orchestrator/workflows.js';
import { detectPlatforms, extractProduct, makePlan } from '../src/orchestrator/planner.js';

describe('planner', () => {
  it('detects platforms in Vietnamese goals', () => {
    expect(detectPlatforms('Quảng bá bộ quà Tết này lên Zalo, Facebook, TikTok và Threads.').sort()).toEqual(['facebook', 'threads', 'tiktok', 'zalo']);
    expect(detectPlatforms('Đăng bài lên fanpage và tik tok')).toEqual(['facebook', 'tiktok']);
    expect(detectPlatforms('Viết bài giới thiệu sản phẩm')).toEqual([]);
  });

  it('extracts the product name', () => {
    expect(extractProduct('Quảng bá bộ quà Tết này lên Zalo, Facebook')).toBe('Bộ quà Tết');
    expect(extractProduct('Giới thiệu răng gầu K100 tới khách hàng')).toBe('Răng gầu K100');
  });

  it('demo plan is labelled as simulated', async () => {
    const p = await makePlan('Quảng bá bộ quà Tết lên Facebook', ['facebook'], null);
    expect(p.generatedBy).toBe('simulated');
    expect(p.platforms).toEqual(['facebook']);
  });
});

describe('workflows', () => {
  const full = BUILTIN_WORKFLOWS.find((w) => w.id === 'wf_full')!;

  it('built-in workflows are valid DAGs', () => {
    for (const w of BUILTIN_WORKFLOWS) expect(validateWorkflow(w)).toBeNull();
  });

  it('drops publishers for unselected platforms', () => {
    const steps = resolveSteps(full, ['facebook']);
    const keys = steps.map((s) => s.key);
    expect(keys).toContain('publish_facebook');
    expect(keys).not.toContain('publish_tiktok');
    expect(steps.find((s) => s.key === 'metrics')!.deps).toEqual(['publish_facebook']);
  });

  it('rewires dependencies through disabled steps', () => {
    const wf = { ...full, steps: full.steps.map((s) => (s.key === 'research' ? { ...s, enabled: false } : s)) };
    const write = resolveSteps(wf, ['facebook']).find((s) => s.key === 'write')!;
    expect(write.deps).toEqual(['plan']);
  });

  it('rejects cycles and unknown deps', () => {
    expect(validateWorkflow({ steps: [{ key: 'a', agent: 'writer', title: 'a', deps: ['b'] }, { key: 'b', agent: 'writer', title: 'b', deps: ['a'] }] })).toMatch(/vòng lặp/);
    expect(validateWorkflow({ steps: [{ key: 'a', agent: 'writer', title: 'a', deps: ['x'] }] })).toMatch(/không tồn tại/);
  });
});
