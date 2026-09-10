// App-wide configuration and runtime capability flags.
//
// Secrets come from EXPO_PUBLIC_* env vars. NOTE: anything prefixed with
// EXPO_PUBLIC_ is inlined into the JS bundle and therefore shippable-but-not-
// secret. That's acceptable for a personal prototype; before releasing this,
// Phase 2 should move the Groq call behind a Supabase Edge Function (the same
// pattern daily-budget uses for slip OCR) so the key never leaves the server.

export const config = {
  /** Groq API key — powers cloud STT (Whisper) and, later, the "brain" LLM. */
  groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '',

  /** Voice-command recognition language. */
  locale: 'th-TH',

  /** Groq model ids (free tier). Check availability: GET /openai/v1/models. */
  groq: {
    sttModel: 'whisper-large-v3',
    llmModel: 'openai/gpt-oss-120b', // "the brain" — strong JSON-mode model
  },

  /**
   * Daily Budget REST bridge — the `budget-api` Edge Function in the sibling
   * daily-budget project. Lets us ask about the budget and log/edit expenses by
   * voice. `url` is the budget-api endpoint; the OAuth token/revoke endpoints
   * are derived from it (sibling functions). `token` is an OPTIONAL legacy
   * single-user shared token; with multi-user OAuth it stays empty and each
   * user connects their own account (see integrations/budgetOAuth.ts).
   */
  budgetApi: {
    url: process.env.EXPO_PUBLIC_BUDGET_API_URL ?? '',
    mcpUrl: process.env.EXPO_PUBLIC_BUDGET_MCP_URL ?? '',
    token: process.env.EXPO_PUBLIC_BUDGET_API_TOKEN ?? '',
  },

  /** OAuth client settings for connecting to a user's own daily-budget account. */
  budgetOAuth: {
    clientId: 'voice-reminder',
    /** Deep link back into THIS app with the authorization code. */
    redirectUri: 'voicereminder://budget-oauth',
    /** Scheme of the daily-budget app — its consent screen is `://connect`. */
    providerScheme: 'dailybudget',
    scopes: 'budget.read budget.write',
  },

  /**
   * Optional public HTTPS URL used in shared-space invitations. Until a
   * production domain is configured, native builds use the app's
   * `voicereminder://` scheme and web uses its current origin.
   */
  sharing: {
    inviteBaseUrl: (process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? '').replace(/\/+$/, ''),
  },
} as const;

export function isGroqConfigured(): boolean {
  return config.groqApiKey.length > 0;
}

/** True once the daily-budget REST bridge endpoint is configured (URL set). */
export function isBudgetApiConfigured(): boolean {
  return config.budgetApi.url.length > 0;
}

/** Derive a sibling Edge Function URL (oauth-token, oauth-revoke) from the
 *  configured budget-api URL by swapping the last path segment. */
export function budgetFunctionUrl(name: string): string {
  const base = config.budgetApi.url.replace(/\/[^/]*$/, '');
  return `${base}/${name}`;
}
