import { http } from './http.js';
import { cred } from './registry.js';
import { googleToken } from './tokens.js';

export async function listDriveMedia(signal?: AbortSignal) {
  const folder = cred('gdrive', 'folderId');
  if (!folder) return [];
  const t = await googleToken();
  const q = encodeURIComponent(`'${folder.replace(/'/g, '')}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`);
  const r = await http(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=50&fields=files(id,name,mimeType,size,md5Checksum)`, {
    headers: { Authorization: `Bearer ${t}` }, label: 'Google Drive', signal,
  });
  return (r.files ?? []) as { id: string; name: string; mimeType: string; size?: string; md5Checksum?: string }[];
}

export async function downloadDriveFile(fileId: string, signal?: AbortSignal) {
  const t = await googleToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${t}` }, signal });
  if (!res.ok) throw new Error(`Google Drive tải file lỗi ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function testDrive() {
  const files = await listDriveMedia();
  return `OK — thư mục có ${files.length} ảnh/video`;
}
