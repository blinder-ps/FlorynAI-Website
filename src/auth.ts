import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdmin, getSupabaseForToken } from './supabase.js';

export interface AuthenticatedRequest extends Request { userId?: string; accessToken?: string }

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: { code: 'unauthorized', message: 'Authentication required.' } }); return; }
  const token = header.slice(7);
  const client = getSupabaseForToken(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) { res.status(401).json({ success: false, error: { code: 'invalid_session', message: 'Your session is invalid or expired.' } }); return; }
  const { data: profile } = await getSupabaseAdmin().from('profiles').select('status').eq('id', data.user.id).maybeSingle();
  if (!profile || profile.status !== 'active') { res.status(403).json({ success: false, error: { code: 'access_denied', message: 'Your account is not active.' } }); return; }
  req.userId = data.user.id; req.accessToken = token; next();
}
