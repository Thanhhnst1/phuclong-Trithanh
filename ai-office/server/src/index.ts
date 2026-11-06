import { config } from './config.js';
import { bootstrap } from './bootstrap.js';
import { buildApp, getMode } from './app.js';
import { runAutoHunt } from './orchestrator/autohunt.js';
import { engine } from './orchestrator/engine.js';
import { initVault, vaultKeySource } from './core/vault.js';
import { users } from './db/index.js';

await bootstrap();
initVault();
const app = await buildApp();
engine.start();
setInterval(() => { try { runAutoHunt(getMode()); } catch (e) { console.error('autohunt', e); } }, 30000);
await app.listen({ port: config.port, host: config.host });

console.log(`\n🏢 AI Office đang chạy: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
if (users.count() === 0) console.log('   → Mở trình duyệt để tạo tài khoản quản trị đầu tiên.');
if (vaultKeySource === 'file') console.log('   ⚠ Chưa đặt APP_SECRET: khóa mã hóa đang lưu tại data/.master-key (chỉ dùng cho máy cá nhân).');
if (!config.publicBaseUrl) console.log('   ℹ Chưa đặt PUBLIC_BASE_URL: OAuth, Threads ảnh và Zalo OA sẽ dùng quy trình thay thế.');

const shutdown = async () => {
  await engine.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
