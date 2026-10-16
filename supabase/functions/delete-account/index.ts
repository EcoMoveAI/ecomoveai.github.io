/**
 * POST /functions/v1/delete-account
 * Body: { confirm: "DELETE" }
 *
 * Permanently deletes the authenticated user's auth account. All user-owned rows are removed by
 * ON DELETE CASCADE foreign keys. The service-role key is used only for this single admin call and only
 * for the user id verified from the caller's own JWT.
 */
import { createClient } from '@supabase/supabase-js';
import { authenticate, env, handleError, HttpFailure, json, preflight, readJson } from '../_shared/request.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  try {
    const { user } = await authenticate(req);
    const body = (await readJson(req, 1_000)) as { confirm?: unknown };
    if (body.confirm !== 'DELETE') throw new HttpFailure(400, 'confirmation_required', 'Send { "confirm": "DELETE" } to delete the account.');
    const url = env('SUPABASE_URL');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new HttpFailure(500, 'server_misconfigured', 'Service role key not available.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new HttpFailure(500, 'delete_failed', 'Account deletion failed. Please try again.');
    return json(req, { deleted: true });
  } catch (e) {
    return handleError(req, e);
  }
});
