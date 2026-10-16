/**
 * Calls to EcoMove Edge Functions. All require a signed-in user; the server holds the LLM and Maps keys.
 */
import { supabase } from './supabase';

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function invoke<T>(fn: string, body: Record<string, unknown>, timeoutMs = 95_000): Promise<T> {
  if (!supabase) throw new ApiError('not_configured', 'Cloud features are not configured in this build.');
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new ApiError('signed_out', 'Sign in to use this feature.');
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new ApiError('timeout', 'The request timed out.')), timeoutMs));
  const call = supabase.functions.invoke<T>(fn, { body }).then(async ({ data, error }) => {
    if (error) {
      // FunctionsHttpError carries the response; surface the server's error code/message when present.
      const ctx = (error as { context?: Response }).context;
      let payload: { error?: string; message?: string } | null = null;
      try {
        payload = ctx ? await ctx.json() : null;
      } catch {
        payload = null;
      }
      throw new ApiError(payload?.error ?? 'request_failed', payload?.message ?? 'The server could not be reached. Check your connection.');
    }
    return data as T;
  });
  return Promise.race([call, timeout]);
}

export interface AgentReply {
  reply: string;
  /** 'ok' | 'max_steps' | 'refusal' | 'llm_error' | 'deadline' */
  status: string;
  /** Set when status is 'llm_error': 'quota' | 'rate_limited' | 'auth' | 'timeout' | 'unavailable' | 'bad_request'. */
  errorKind?: string;
  tools: { name: string; ok: boolean }[];
  model: string;
}

/** Supabase Edge Function that runs the tool-using assistant (Gemini by default). */
export const ASSISTANT_FUNCTION = 'mobility-assistant';

export function askAgent(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<AgentReply> {
  return invoke<AgentReply>(ASSISTANT_FUNCTION, { messages });
}

export function deleteCloudAccount(): Promise<{ deleted: boolean }> {
  return invoke<{ deleted: boolean }>('delete-account', { confirm: 'DELETE' }, 20_000);
}
