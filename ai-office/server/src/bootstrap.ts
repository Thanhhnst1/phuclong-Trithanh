import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs, paths } from './config.js';
import { openDb, settings, assets } from './db/index.js';
import { seedWorkflows } from './orchestrator/workflows.js';
import { storeAsset } from './media/index.js';

/** Open DB, create tables, seed built-in workflows and the demo media library. */
export async function bootstrap(dbFile = paths.db) {
  ensureDirs();
  openDb(dbFile);
  seedWorkflows();
  if (!settings.get('mode')) settings.set('mode', 'demo');
  await seedLibrary();
}

export async function seedLibrary(dir = config.seedDir) {
  if (settings.get('library.seeded') === '1') return 0;
  let n = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
      const label = f.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ').replace(/\(.*?\)\s*/g, '').trim();
      if (assets.list({ library: true }).some((a) => a.label === label)) continue;
      await storeAsset({
        buffer: fs.readFileSync(path.join(dir, f)), filename: f, campaignId: null, role: 'source',
        source: 'Thư viện nội bộ (ảnh sản phẩm có sẵn trong repo)', license: 'Sở hữu — ảnh sản phẩm của doanh nghiệp', label,
      });
      n++;
    }
  }
  settings.set('library.seeded', '1');
  return n;
}
