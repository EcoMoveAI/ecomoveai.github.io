/**
 * Provider selection. `LLM_PROVIDER` picks the implementation (default `gemini`); each reads its own
 * secret. Adding a provider means implementing `LLMProvider` (core/agent/orchestrator.ts) and adding a
 * case here — the tools, orchestrator, app and analytics do not change.
 */
import type { LLMProvider } from '../core/agent/orchestrator.ts';
import { anthropicFromEnv } from './anthropic.ts';
import { geminiFromEnv } from './gemini.ts';

export const SUPPORTED_PROVIDERS = ['gemini', 'anthropic'] as const;

export function providerFromEnv(get: (k: string) => string | undefined): LLMProvider | null {
  const provider = (get('LLM_PROVIDER') ?? 'gemini').toLowerCase();
  if (provider === 'gemini') return geminiFromEnv(get);
  if (provider === 'anthropic') return anthropicFromEnv(get);
  return null;
}

/** Name of the secret the selected provider needs (for the "not configured" message). */
export function requiredSecretName(get: (k: string) => string | undefined): string {
  return (get('LLM_PROVIDER') ?? 'gemini').toLowerCase() === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
}
