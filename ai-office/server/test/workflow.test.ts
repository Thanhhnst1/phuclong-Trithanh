import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOWS, resolveSteps, validateWorkflow } from '../src/orchestrator/workflows.js';
import { detectCategories, detectPlatforms, makePlan } from '../src/orchestrator/planner.js';
import { fingerprint, similarity } from '../src/agents/storyUtil.js';

describe('planner', () => {
  it('detects platforms and categories in Vietnamese requests', () => {
    expect(detectPlatforms('Đăng lên fanpage và Threads')).toEqual(['facebook', 'threads']);
    expect(detectPlatforms('Săn tin kỳ lạ')).toEqual([]);
    expect(detectCategories('Tìm chuyện bí ẩn và khám phá khoa học, khảo cổ')).toEqual(['Bí ẩn chưa có lời giải', 'Khám phá khoa học', 'Khảo cổ & lịch sử']);
  });

  it('demo plan is labelled simulated and clamps topic count to 5-10', async () => {
    const p = await makePlan('Săn chuyện lạ', ['facebook'], { count: 20, categories: [], region: 'world' }, null);
    expect(p.generatedBy).toBe('simulated');
    expect(p.count).toBe(10);
    expect(p.avoid.join(' ')).toMatch(/Không bịa/);
  });
});

describe('topic de-duplication', () => {
  it('matches the same story written differently', () => {
    const a = fingerprint('Phát hiện thành phố cổ dưới đáy hồ ở Peru');
    const b = fingerprint('Peru: phát hiện thành phố cổ dưới đáy hồ');
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0.5);
    expect(similarity(a, fingerprint('Robot AI tự viết phần mềm'))).toBeLessThan(0.2);
  });
});

describe('workflows', () => {
  const nr = BUILTIN_WORKFLOWS.find((w) => w.id === 'wf_newsroom')!;
  it('built-in workflows are valid DAGs', () => {
    for (const w of BUILTIN_WORKFLOWS) expect(validateWorkflow(w)).toBeNull();
  });
  it('drops publishers for unselected platforms', () => {
    const steps = resolveSteps(nr, ['facebook']);
    expect(steps.map((s) => s.key)).not.toContain('publish_tiktok');
    expect(steps.find((s) => s.key === 'metrics')!.deps).toEqual(['publish_facebook']);
  });
  it('rewires dependencies through disabled steps', () => {
    const wf = { ...nr, steps: nr.steps.map((s) => (s.key === 'edit' ? { ...s, enabled: false } : s)) };
    expect(resolveSteps(wf, ['facebook']).find((s) => s.key === 'approve')!.deps.sort()).toEqual(['select', 'write']);
  });
  it('rejects cycles and unknown deps', () => {
    expect(validateWorkflow({ steps: [{ key: 'a', agent: 'writer', title: 'a', deps: ['b'] }, { key: 'b', agent: 'writer', title: 'b', deps: ['a'] }] })).toMatch(/vòng lặp/);
    expect(validateWorkflow({ steps: [{ key: 'a', agent: 'writer', title: 'a', deps: ['x'] }] })).toMatch(/không tồn tại/);
  });
});
