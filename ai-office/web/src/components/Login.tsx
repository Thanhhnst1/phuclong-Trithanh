import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';

export function Login() {
  const { needsBootstrap, checkAuth } = useStore();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post(needsBootstrap ? '/api/auth/bootstrap' : '/api/auth/login', { email, password, ...(needsBootstrap && { name }) });
      await checkAuth();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-full place-items-center p-4" style={{ background: 'linear-gradient(160deg, var(--sky1), var(--sky2))' }}>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 shadow-soft">
        <div className="text-center">
          <div className="text-4xl">🏝️🗞️</div>
          <h1 className="mt-2 text-xl font-extrabold">Tòa soạn AI</h1>
          <p className="text-sm text-mute">{needsBootstrap ? 'Lần đầu sử dụng — tạo tài khoản quản trị' : 'Săn nhanh · Kiểm chứng kỹ · Kể chuyện cuốn hút'}</p>
        </div>
        {needsBootstrap && <input className="input" placeholder="Họ tên" value={name} onChange={(e) => setName(e.target.value)} />}
        <input className="input" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder={needsBootstrap ? 'Mật khẩu (≥ 8 ký tự)' : 'Mật khẩu'} autoComplete={needsBootstrap ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{needsBootstrap ? 'Tạo tài khoản & vào văn phòng' : 'Đăng nhập'}</button>
      </form>
    </div>
  );
}
