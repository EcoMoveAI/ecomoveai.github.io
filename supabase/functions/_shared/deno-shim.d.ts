// Type-only shim so `tsc -p tsconfig.functions.json` can check Edge Functions under Node tooling.
// At runtime the real Deno global is provided by the Supabase Edge Runtime.
declare namespace Deno {
  export const env: { get(name: string): string | undefined };
  export function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
