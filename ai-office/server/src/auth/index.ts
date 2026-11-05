import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessions, users, type UserRow } from '../db/index.js';
import type { Role } from '../core/types.js';
import { config } from '../config.js';

export const SESSION_COOKIE = 'aio_session';
const SESSION_DAYS = 14;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(reply: FastifyReply, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  sessions.create(sha(token), userId, expires.toISOString());
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires,
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.remove(sha(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export type PublicUser = Pick<UserRow, 'id' | 'email' | 'name' | 'role'>;
export const publicUser = (u: UserRow): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export function currentUser(req: FastifyRequest): UserRow | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const s = sessions.get(sha(token));
  if (!s || s.expires_at < new Date().toISOString()) return null;
  return users.byId(s.user_id);
}

const rank: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

/** Fastify preHandler factory: require a logged-in user with at least `min` role. */
export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const u = currentUser(req);
    if (!u) return reply.code(401).send({ error: 'Chưa đăng nhập' });
    if (rank[u.role] < rank[min]) return reply.code(403).send({ error: 'Không đủ quyền' });
    (req as any).user = u;
  };
}

export const userOf = (req: FastifyRequest) => (req as any).user as UserRow;
