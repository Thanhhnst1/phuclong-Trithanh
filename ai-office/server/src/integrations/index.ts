import { FatalError } from '../core/types.js';
import { anthropicKey, currentModel } from '../llm/index.js';
import Anthropic from '@anthropic-ai/sdk';
import { testFacebook } from './facebook.js';
import { testThreads } from './threads.js';
import { testTikTok } from './tiktok.js';
import { testZalo } from './zalo.js';
import { testTavily, testPexels } from './research.js';
import { testDrive } from './gdrive.js';

export * from './registry.js';

export async function testIntegration(key: string): Promise<string> {
  switch (key) {
    case 'anthropic': {
      const k = anthropicKey();
      if (!k) throw new FatalError('Chưa có API key');
      const m = await new Anthropic({ apiKey: k }).models.retrieve(currentModel());
      return `OK — model ${m.id} sẵn sàng`;
    }
    case 'facebook': return testFacebook();
    case 'threads': return testThreads();
    case 'tiktok': return testTikTok();
    case 'zalo': return testZalo();
    case 'tavily': return testTavily();
    case 'pexels': return testPexels();
    case 'gdrive': return testDrive();
    default: throw new FatalError('Tích hợp không tồn tại');
  }
}
