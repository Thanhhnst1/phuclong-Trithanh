# 🗞️ Tòa soạn AI — săn tin nóng, chuyện kỳ lạ có thật cho Facebook

Một **Tổng biên tập (Orchestrator)** điều phối **9 AI Agent** làm việc như một tòa soạn:
**săn chủ đề HOT → kiểm chứng bắt buộc → anh chọn chủ đề → thiết kế ảnh ∥ viết bài → anh duyệt → đăng** lên trang Facebook chính (tùy chọn thêm Threads, Zalo OA, TikTok) → **báo cáo PDF/Excel**. Mọi thứ hiện trực tiếp trên văn phòng ảo isometric.

> Nguyên tắc: **uy tín đứng trên lượt xem**. Không bịa sự kiện/nguồn, không giật tít sai sự thật, không biến tin đồn thành sự thật, tách rõ *đã xác nhận / lời kể / giả thuyết*.

![Văn phòng ảo](docs/screenshot-desktop.jpg)

---

## 1. Chạy trên máy (Windows / Mac)

Yêu cầu: **Node.js ≥ 22.13**, Git; `ffmpeg` nếu muốn dựng video TikTok.

```bash
git clone -b claude/multi-ai-agent-system-qe8lqw https://github.com/Thanhhnst1/phuclong-Trithanh.git
cd phuclong-Trithanh/ai-office
npm install
npm run build
npm start            # mở http://127.0.0.1:8787
```
Windows báo `running scripts is disabled` → chạy 1 lần: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Lần đầu: tạo tài khoản quản trị → tab **Săn tin** → gõ yêu cầu, ví dụ
> Săn 8 câu chuyện kỳ lạ, bí ẩn có thật trong tuần này cho trang Facebook.

### Demo Mode vs có Claude
| | Chưa có API key (Demo) | Có Claude API key |
|---|---|---|
| Săn tin | Chủ đề **[MẪU DEMO]** rõ ràng là giả để thử quy trình | Claude **web search** thật: báo chí, khoa học, MXH, trong nước & thế giới |
| Kiểm chứng | Không kiểm chứng (ghi rõ) | Truy nguồn gốc, ≥2 nguồn độc lập, phát hiện tin cũ đăng lại, rủi ro ảnh/pháp lý |
| Viết bài | Bài mẫu gắn nhãn | Bài Facebook hook mạnh, có cao trào, câu hỏi mở, **luôn ghi nguồn** |
| Ảnh | Thẻ chữ thật (gắn nhãn "Ảnh minh họa") | như bên trái, hoặc ảnh thật có nguồn do anh tải lên |
| Đăng | Chỉ mô phỏng | Production: đăng thật (đã kết nối) hoặc gói đăng tay |

Nhập key: tab **Kết nối → Claude** (mã hóa trong DB). Model mặc định `claude-opus-5-5`.

Chạy test: `npm test` (17 test, gồm: chặn URL nguồn do AI tự bịa, tự hạ "đã xác nhận" khi chỉ 1 nguồn, chống lặp chủ đề giữa các phiên, 2 cổng duyệt, retry/hủy, production thiếu kết nối → đăng tay, săn tin tự động hằng ngày).

---

## 1b. Quy trình tòa soạn (`wf_newsroom`)

| # | Bước | Agent | Kết quả |
|---|------|-------|---------|
| 1 | Lập kế hoạch | 🧠 Tổng biên tập | hướng săn tin, nhóm chủ đề, truy vấn, điều cấm |
| 2 | Săn chủ đề HOT | 🛰️ Phóng viên | ~N+4 ứng viên; **bỏ chủ đề trùng** với kho chủ đề cũ; chỉ giữ URL có thật trong kết quả tìm kiếm |
| 3 | Kiểm chứng | 🕵️ Kiểm chứng viên | mỗi chủ đề: *Đã xác nhận / Xác nhận một phần / Chưa đủ bằng chứng*, sự thật vs giả thuyết, rủi ro → **Đề xuất / Chờ kiểm chứng / Loại** |
| 4 | **Anh chọn chủ đề** | 🧠 | tab **Chủ đề**: 5–10 đề xuất với tiêu đề, tóm tắt, thời gian–địa điểm, trạng thái xác minh, nguồn, lý do thu hút, góc khai thác, điểm hấp dẫn 1–10 |
| 5 | Thiết kế ảnh ∥ Viết bài | 🎨 ∥ ✍️ | thẻ ảnh 4:5 cho Facebook (ảnh thật có nguồn nếu anh tải lên), 2 phương án bài/nền tảng |
| 6 | **Anh duyệt bài** | 🧠 | chọn phương án + ảnh, sửa chữ, hoặc gửi góp ý viết lại |
| 7 | Đăng | 📘 (🧵 💬 🎵) | giãn cách 5 giây giữa các bài; ghi link & trạng thái |
| 8–9 | Số liệu → Báo cáo | 📊 | reactions/comments/shares (bài thật) → PDF + Excel kèm danh sách chủ đề & nguồn |

Workflow phụ `wf_proposals`: chỉ săn + kiểm chứng + báo cáo danh sách chủ đề (anh tự triển khai).
**Săn tin tự động hằng ngày**: tab Workflow → bật lịch (giờ, yêu cầu, số chủ đề). Bài vẫn chờ anh chọn & duyệt.

## 2. Kiến trúc

```
                 ┌───────────────────────── Web (React + TS + Tailwind) ─────────────────────────┐
                 │  Văn phòng isometric (SVG 2.5D)  ·  Chiến dịch  ·  Duyệt  ·  Tư liệu  ·  Báo cáo │
                 │  Kết nối  ·  Workflow  ·  Nhật ký  ·  Người dùng        ◄── SSE realtime ──┐    │
                 └──────────────────────────────┬──────────────────────────────────────────────┘    │
                                    REST /api   │                                                   │
┌───────────────────────────────── Server (Node + Fastify + TypeScript) ──────────────────────────┐ │
│ Auth (scrypt, cookie session, admin/editor/viewer)    Vault AES-256-GCM cho API key/token        │ │
│                                                                                                   │ │
│  Orchestrator Engine ── task queue bền (SQLite) ── worker pool (song song, 1 việc/agent)          │ │
│    • DAG phụ thuộc • retry + backoff • timeout • agent dự phòng • cổng phê duyệt                 │─┘
│    • pause/resume/cancel • hẹn giờ bắt đầu & hẹn giờ đăng • khôi phục sau khi khởi động lại       │
│                                                                                                   │
│  Agents: Planner · Researcher · Collector · Editor · Writer · Zalo · Facebook · TikTok · Threads │
│          · Reporter (số liệu + báo cáo)                                                           │
│  LLM: Claude (claude-opus-5-5, web search, MCP connector) — interface thay được model khác        │
│  Media: sharp (poster, dHash chống trùng) · ffmpeg (video 9:16) · URL ký số cho nền tảng          │
│  Integrations: Zalo OA · Meta Graph · TikTok Content Posting · Threads · Drive · Tavily · Pexels  │
│  Reports: Excel (exceljs) · PDF (pdfkit + font DejaVu tiếng Việt)                                 │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Thư mục

```
ai-office/
├── server/src
│   ├── agents/                # researcher (săn tin), factchecker, editor (ảnh), writer, publishers, reporter
│   ├── app.ts                 # toàn bộ REST API + SSE + phục vụ web build
│   ├── orchestrator/          # engine.ts (queue/worker), planner.ts, workflows.ts
│   ├── integrations/          # adapter từng nền tảng, OAuth, MCP, token refresh
│   ├── llm/                   # interface LLM + Claude
│   ├── media/                 # lưu trữ, poster, video, URL công khai ký số
│   ├── reports/               # Excel / PDF / tổng quan
│   ├── auth/  core/  db/      # phân quyền, vault, event bus, SQLite
└── server/test/               # vitest
├── web/src
│   ├── components/office/     # OfficeScene, Building, Avatar, AgentStrip, iso.ts
│   ├── components/panels/     # các bảng điều khiển
│   └── lib/                   # api client, store (zustand + SSE)
└── docs/
```

### Nguyên tắc trung thực của kết quả

Mọi task/bài đăng mang nhãn nguồn gốc: **Thật** · **AI** · **Mô phỏng** · **Thủ công** · **Không có dữ liệu**. Bài mô phỏng không bao giờ có link hay số liệu; số liệu tương tác chỉ lấy từ API của bài đăng thật.

---

## 3. Chuyển sang Production

1. Tạo file `.env` từ `.env.example`, đặt **`APP_SECRET`** (bắt buộc) và **`PUBLIC_BASE_URL`** (URL https công khai — cần cho OAuth, ảnh Threads, ảnh bìa Zalo OA).
2. Tab **Kết nối**: nhập Claude API key → "Kiểm tra". Nhập thông tin ứng dụng từng nền tảng rồi "Kết nối bằng OAuth" (hoặc dán token trực tiếp).
3. Chuyển **Chế độ vận hành → Production** (chỉ admin).
4. Nền tảng nào chưa kết nối sẽ tự chuyển sang **đăng thủ công**: hệ thống chuẩn bị caption + media để tải về, anh đăng tay rồi dán link → báo cáo ghi "Đã đăng tay".

Redirect URI OAuth cần đăng ký với nền tảng: `{PUBLIC_BASE_URL}/api/oauth/{facebook|threads|tiktok|zalo|gdrive}/callback`.

### Khả năng tích hợp từng nền tảng

| Nền tảng | Làm được tự động | Không làm được / thay thế | Quyền cần |
|---|---|---|---|
| **Zalo OA** | Tạo & xuất bản bài viết OA (article) có ảnh bìa | **Không có API đọc/đăng nhóm Zalo cá nhân** → tải tệp từ nhóm về rồi upload (tab Tư liệu); đăng nhóm bằng gói thủ công. Broadcast/ZNS cần gói trả phí — chưa tích hợp | App Zalo for Developers liên kết OA đã xác thực |
| **Facebook Page** | Đăng ảnh/video/bài chữ lên Page, đọc reactions/comments/shares | Không đăng Group/trang cá nhân | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| **TikTok** | Upload video: **Inbox** (vào hộp nháp, mặc định) hoặc **Direct Post** | App chưa audit chỉ đăng được `SELF_ONLY`; MVP chưa làm photo mode | `video.upload`, `video.publish`, `user.info.basic` |
| **Threads** | Bài chữ / bài ảnh (container → publish), insights | Ảnh cần URL công khai; thiếu `PUBLIC_BASE_URL` → đăng bài chữ | `threads_basic`, `threads_content_publish`, `threads_manage_insights` |
| **Google Drive** | Lấy ảnh trong 1 thư mục (readonly) | — | `drive.readonly` |
| **Claude** | Kế hoạch, nghiên cứu có web search + nguồn, viết bài, MCP connector | — | API key |
| **Tavily / Pexels** | Tìm web / ảnh stock có giấy phép | — | API key |

> ⚠️ **Lưu ý xác minh:** các adapter được viết theo tài liệu chính thức của từng nền tảng nhưng **chưa được gọi thử với tài khoản thật** trong quá trình xây dựng (chưa có credential). Lần đầu kết nối, hãy dùng nút **Kiểm tra** và đăng thử 1 bài ở chế độ riêng tư/nháp. Phiên bản Graph API cấu hình qua `FB_GRAPH_VERSION`.

### MCP Server

Tab Kết nối → MCP Servers: thêm server MCP từ xa (HTTPS + Bearer token tùy chọn). Researcher sẽ cho Claude dùng các công cụ đó qua MCP connector; nút "Kiểm tra" liệt kê tool bằng MCP SDK.

---

## 4. Phân quyền & bảo mật

- **admin**: mọi quyền, cấu hình kết nối, đổi chế độ, quản lý người dùng. **editor**: tạo/điều khiển chiến dịch, duyệt, upload. **viewer**: chỉ xem.
- Mật khẩu băm scrypt; phiên đăng nhập bằng cookie httpOnly SameSite=Lax (đặt `COOKIE_SECURE=true` sau HTTPS).
- API key/token mã hóa AES-256-GCM trong DB, **không bao giờ trả về trình duyệt** (chỉ hiện dạng `abcd••••wxyz`). Không hardcode key trong code.
- Media chỉ truy cập khi đăng nhập; URL công khai cho nền tảng được **ký HMAC, hết hạn sau 7 ngày**.
- Upload bắt buộc xác nhận quyền sử dụng; mỗi tư liệu lưu nguồn + giấy phép.

## 5. Triển khai lên server

```bash
# trên VPS (Ubuntu): cài Node 22 + ffmpeg, rồi
git clone … && cd ai-office && npm ci && npm run build
cp .env.example .env   # đặt APP_SECRET, PUBLIC_BASE_URL, HOST=127.0.0.1, COOKIE_SECURE=true
npm start              # hoặc dùng pm2/systemd
```
Đặt Nginx/Caddy reverse proxy HTTPS → `127.0.0.1:8787` (tắt buffering cho `/api/events` để SSE chạy realtime: `proxy_buffering off;`). Sao lưu thư mục `server/data/` (SQLite + media + khóa).

Mở rộng: engine dùng hàng đợi trong SQLite + event bus nội bộ, phù hợp 1 server. Khi cần nhiều worker: thay `orchestrator/engine.ts` tick loop bằng BullMQ/Redis và `core/bus.ts` bằng Redis pub/sub — schema task giữ nguyên.

## 6. Phần chưa có / bước tiếp theo

- Chưa kiểm thử với tài khoản Zalo/Meta/TikTok thật (xem lưu ý ở trên).
- TikTok photo mode, Facebook album nhiều ảnh, Zalo broadcast/ZNS.
- Thu số liệu TikTok (cần scope `video.list`) và lịch thu số liệu định kỳ sau khi đăng.
- Tạo ảnh bằng AI chưa tích hợp (thẻ chữ minh họa đã có). Theo dõi diễn biến mới của một chủ đề cũ: hiện làm bằng cách tạo phiên săn tin mới nêu rõ chủ đề.
- Ảnh tham chiếu giao diện chưa được tải lên — giao diện thiết kế theo mô tả (đảo nổi isometric, pastel).
