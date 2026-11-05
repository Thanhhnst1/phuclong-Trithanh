import { vault } from '../core/vault.js';
import { secretsTable } from '../db/index.js';
import { config } from '../config.js';

export interface FieldDef {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface IntegrationDef {
  key: string;
  name: string;
  category: 'ai' | 'research' | 'assets' | 'publish';
  agent?: string;
  description: string;
  /** What the official API actually allows today — shown in the UI so nobody assumes more. */
  capabilities: string[];
  limitations: string[];
  permissions: string[];
  docs: string;
  fields: FieldDef[];
  oauth?: boolean;
  needsPublicUrl?: boolean;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'anthropic',
    name: 'Claude (Anthropic API)',
    category: 'ai',
    description: 'Bộ não suy luận cho Orchestrator, Researcher (kèm web search), Writer.',
    capabilities: ['Lập kế hoạch chiến dịch', 'Nghiên cứu có web search + trích nguồn', 'Viết nội dung nhiều phương án', 'Kết nối MCP server từ xa qua MCP connector'],
    limitations: ['Tính phí theo token', 'Không có key → hệ thống dùng mẫu demo (gắn nhãn MÔ PHỎNG)'],
    permissions: ['API key từ console.anthropic.com'],
    docs: 'https://platform.claude.com/docs',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'sk-ant-...' }],
  },
  {
    key: 'tavily',
    name: 'Tavily Search',
    category: 'research',
    agent: 'researcher',
    description: 'Tìm kiếm web cho Researcher khi không dùng Claude web search.',
    capabilities: ['Tìm kiếm web, trả về tiêu đề/URL/trích đoạn'],
    limitations: ['Gói miễn phí giới hạn số lượt tìm'],
    permissions: ['API key từ tavily.com'],
    docs: 'https://docs.tavily.com',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'tvly-...' }],
  },
  {
    key: 'pexels',
    name: 'Pexels (ảnh có giấy phép)',
    category: 'assets',
    agent: 'collector',
    description: 'Nguồn ảnh stock miễn phí, giấy phép Pexels cho phép dùng thương mại.',
    capabilities: ['Tìm ảnh theo từ khóa', 'Ghi nguồn + tác giả tự động'],
    limitations: ['Không dùng để mô tả sản phẩm thật của bạn — chỉ ảnh minh họa'],
    permissions: ['API key từ pexels.com/api'],
    docs: 'https://www.pexels.com/api/documentation/',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }],
  },
  {
    key: 'gdrive',
    name: 'Google Drive',
    category: 'assets',
    agent: 'collector',
    description: 'Lấy ảnh/video từ một thư mục Drive được chia sẻ cho ứng dụng.',
    capabilities: ['Liệt kê & tải ảnh/video trong thư mục chỉ định (drive.readonly)'],
    limitations: ['Cần OAuth client (Web) trên Google Cloud Console'],
    permissions: ['Scope https://www.googleapis.com/auth/drive.readonly'],
    docs: 'https://developers.google.com/drive/api/guides/about-sdk',
    oauth: true,
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', secret: false, required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', secret: true, required: true },
      { key: 'folderId', label: 'ID thư mục Drive', secret: false, required: true, help: 'Phần cuối URL thư mục: drive.google.com/drive/folders/<ID>' },
      { key: 'refreshToken', label: 'Refresh token (tự điền sau OAuth)', secret: true, required: false },
    ],
  },
  {
    key: 'zalo',
    name: 'Zalo Official Account',
    category: 'publish',
    agent: 'zalo',
    description: 'Đăng bài viết (article) lên Zalo OA qua Zalo OA Open API.',
    capabilities: ['Tạo bài viết OA (tiêu đề, ảnh bìa, nội dung)', 'Lấy thông tin OA để kiểm tra kết nối'],
    limitations: [
      'KHÔNG có API chính thức để đọc hay đăng vào nhóm Zalo cá nhân → dùng quy trình thủ công (tải gói nội dung, đăng tay, dán link).',
      'Ảnh bìa phải là URL công khai → cần PUBLIC_BASE_URL.',
      'Gửi tin broadcast/ZNS cần gói trả phí và mẫu được duyệt — chưa tích hợp.',
    ],
    permissions: ['Ứng dụng Zalo for Developers liên kết OA', 'OA đã xác thực', 'Quyền quản lý bài viết'],
    docs: 'https://developers.zalo.me/docs/official-account',
    oauth: true,
    needsPublicUrl: true,
    fields: [
      { key: 'appId', label: 'App ID', secret: false, required: true },
      { key: 'secretKey', label: 'App Secret key', secret: true, required: true },
      { key: 'accessToken', label: 'OA access token (tự điền sau OAuth)', secret: true, required: false },
      { key: 'refreshToken', label: 'Refresh token', secret: true, required: false },
      { key: 'author', label: 'Tên tác giả bài viết', secret: false, required: false, placeholder: 'Phúc Long' },
    ],
  },
  {
    key: 'facebook',
    name: 'Facebook Page (Meta Graph API)',
    category: 'publish',
    agent: 'facebook',
    description: 'Đăng ảnh/video + caption lên Page bạn quản lý.',
    capabilities: ['Đăng ảnh kèm caption (/{page-id}/photos)', 'Đăng video (/{page-id}/videos)', 'Đăng bài chữ (/{page-id}/feed)', 'Đọc reactions/comments/shares của bài'],
    limitations: ['Chỉ Page (không đăng lên trang cá nhân hay Group)', 'App phải được Meta duyệt quyền khi dùng cho Page của người khác'],
    permissions: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    docs: 'https://developers.facebook.com/docs/pages-api/posts',
    oauth: true,
    fields: [
      { key: 'appId', label: 'Meta App ID', secret: false, required: false, help: 'Cần khi dùng nút "Kết nối bằng OAuth"' },
      { key: 'appSecret', label: 'Meta App Secret', secret: true, required: false },
      { key: 'pageId', label: 'Page ID', secret: false, required: true },
      { key: 'pageAccessToken', label: 'Page access token', secret: true, required: true },
    ],
  },
  {
    key: 'tiktok',
    name: 'TikTok Content Posting API',
    category: 'publish',
    agent: 'tiktok',
    description: 'Tải video lên TikTok: đăng trực tiếp (Direct Post) hoặc gửi vào hộp nháp (Inbox) để người dùng tự hoàn tất.',
    capabilities: ['Upload video (FILE_UPLOAD)', 'Direct Post với privacy do creator chọn', 'Inbox/draft upload → người dùng mở app TikTok để đăng', 'Kiểm tra trạng thái đăng'],
    limitations: [
      'App chưa qua kiểm duyệt (audit) chỉ đăng được ở chế độ riêng tư SELF_ONLY.',
      'Chỉ hỗ trợ video ở MVP này (photo mode cần URL công khai đã xác minh domain).',
    ],
    permissions: ['video.upload (Inbox)', 'video.publish (Direct Post)', 'user.info.basic'],
    docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
    oauth: true,
    fields: [
      { key: 'clientKey', label: 'Client key', secret: false, required: true },
      { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
      { key: 'postMode', label: 'Chế độ (inbox | direct)', secret: false, required: false, placeholder: 'inbox' },
      { key: 'privacyLevel', label: 'Privacy khi Direct Post', secret: false, required: false, placeholder: 'SELF_ONLY' },
      { key: 'accessToken', label: 'Access token (tự điền sau OAuth)', secret: true, required: false },
      { key: 'refreshToken', label: 'Refresh token', secret: true, required: false },
    ],
  },
  {
    key: 'threads',
    name: 'Threads API',
    category: 'publish',
    agent: 'threads',
    description: 'Đăng bài chữ hoặc ảnh lên Threads qua quy trình container → publish.',
    capabilities: ['Bài chữ (≤500 ký tự)', 'Bài ảnh (image_url công khai)', 'Đọc insights: views, likes, replies, reposts'],
    limitations: ['Ảnh phải là URL công khai → cần PUBLIC_BASE_URL; nếu thiếu sẽ đăng bài chữ', 'Giới hạn 250 bài/24h'],
    permissions: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
    docs: 'https://developers.facebook.com/docs/threads',
    oauth: true,
    needsPublicUrl: true,
    fields: [
      { key: 'appId', label: 'Threads App ID', secret: false, required: false },
      { key: 'appSecret', label: 'Threads App Secret', secret: true, required: false },
      { key: 'userId', label: 'Threads user ID', secret: false, required: true },
      { key: 'accessToken', label: 'Access token', secret: true, required: true },
    ],
  },
];

export const integrationDef = (k: string) => INTEGRATIONS.find((i) => i.key === k) ?? null;

export const cred = (integration: string, field: string) => vault.get(`${integration}.${field}`);
export const setCred = (integration: string, field: string, value: string, by: string | null) => vault.set(`${integration}.${field}`, value, by);

/** Connected = all required fields present. Does not imply the token is still valid — use "Kiểm tra". */
export function isConfigured(k: string): boolean {
  const def = integrationDef(k);
  if (!def) return false;
  if (k === 'anthropic' && process.env.ANTHROPIC_API_KEY) return true;
  const required = def.fields.filter((f) => f.required).map((f) => f.key);
  // OAuth-only integrations are configured once a token exists.
  if (k === 'zalo') return !!cred('zalo', 'accessToken');
  if (k === 'tiktok') return !!cred('tiktok', 'accessToken');
  if (k === 'gdrive') return !!cred('gdrive', 'refreshToken') && !!cred('gdrive', 'folderId');
  return required.every((f) => !!cred(k, f));
}

export function integrationStatus(k: string) {
  const def = integrationDef(k)!;
  const stored = new Map(secretsTable.keys(`${k}.`).map((r) => [r.key.slice(k.length + 1), r.updatedAt]));
  return {
    ...def,
    configured: isConfigured(k),
    publicUrlMissing: !!def.needsPublicUrl && !config.publicBaseUrl,
    values: Object.fromEntries(
      def.fields.map((f) => {
        const v = cred(k, f.key);
        return [f.key, { set: !!v, preview: f.secret ? vault.mask(v) : v, updatedAt: stored.get(f.key) ?? null }];
      }),
    ),
    envKey: k === 'anthropic' && !!process.env.ANTHROPIC_API_KEY,
  };
}
