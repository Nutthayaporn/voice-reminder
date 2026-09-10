function assert(value: unknown): asserts value { if (!value) throw new Error('Assertion failed'); }
Deno.test('Gmail endpoint authenticates users, scopes rows, and rejects unapproved redirects', async () => {
  Deno.env.set('SUPABASE_URL', 'https://vora-test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-server-key');
  Deno.env.set('GOOGLE_GMAIL_CLIENT_ID', 'test-client');
  Deno.env.set('GOOGLE_GMAIL_CLIENT_SECRET', 'test-secret');
  Deno.env.set('GMAIL_TOKEN_KEY', btoa('a'.repeat(32)));
  Deno.env.set('GMAIL_RETURN_URLS', 'voicereminder://gmail/callback');
  let handler: (req: Request) => Promise<Response>;
  const originalServe = Deno.serve, originalFetch = globalThis.fetch;
  Deno.serve = ((callback: typeof handler) => { handler = callback; return {}; }) as typeof Deno.serve;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); requests.push(url);
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'user-a' });
    assert(url.startsWith('https://vora-test.supabase.co/rest/v1/gmail_'));
    assert(new URL(url).searchParams.get('user_id') === 'eq.user-a');
    return Response.json([]);
  }) as typeof fetch;
  try {
    await import('./index.ts');
    const call = (body: unknown, auth = true) => handler(new Request('https://vora-test.supabase.co/functions/v1/gmail-api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer user-token' } : {}) }, body: JSON.stringify(body) }));
    assert((await call({ action: 'tools' }, false)).status === 401);
    assert(requests.length === 0);
    const status = await call({ action: 'status', user_id: 'victim' });
    assert(status.status === 200);
    assert((await status.json()).connections[0].connected === false);
    const before = requests.length;
    assert((await call({ action: 'connect', returnUrl: 'https://attacker.example' })).status === 400);
    assert(requests.length === before + 1); // auth only, no OAuth state written
    assert((await call({ action: 'send' })).status === 400);
  } finally { Deno.serve = originalServe; globalThis.fetch = originalFetch; }
});
