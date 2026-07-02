import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Env } from '../types';
import { getActiveAccountsByFeature, setQuota, addAuditLog } from '../db/models';
import { getAuthHeaders, cfFetchRaw } from '../services/cfApi';
import { getAiUsageToday } from '../services/quotaTracker';

const AI_NEURON_LIMIT = 10000;

/** Upstream status codes that should trigger account rotation. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isNeuronLimitError(text: string): boolean {
  return text.includes('4006') || text.includes('daily free allocation') || text.includes('neuron limit');
}

function isRetryableError(status: number, errorText: string): boolean {
  if (RETRYABLE_STATUS.has(status)) return true;
  return isNeuronLimitError(errorText);
}

const app = new Hono<{ Bindings: Env }>();

async function getAccountsByPriority(db: D1Database, encryptionKey: string) {
  const accounts = await getActiveAccountsByFeature(db, 'ai');
  const results = await Promise.all(accounts.map(async (account) => {
    try {
      const usage = await getAiUsageToday(account, encryptionKey);
      return { account, remaining: AI_NEURON_LIMIT - usage.totalNeurons };
    } catch { return { account, remaining: 0 }; }
  }));
  return results.sort((a, b) => b.remaining - a.remaining).map(r => r.account);
}

app.get('/models', async (c) => {
  const accounts = await getAccountsByPriority(c.env.DB, c.env.ENCRYPTION_KEY);
  if (accounts.length === 0) return c.json({ object: 'list', data: [] });
  const account = accounts[0];

  const resp = await cfFetchRaw(account, `/accounts/${account.account_id}/ai/models/search`, c.env.ENCRYPTION_KEY);
  const json = await resp.json() as any;
  const data = (json.result || []).map((m: any) => ({
    id: m.name || m.id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'cloudflare',
  }));
  return c.json({ object: 'list', data });
});

// Helper: write [DONE] to guarantee OpenAI SDK can return
function writeSseDone(s: any): void {
  s.write('data: [DONE]\n\n');
}

app.post('/chat/completions', async (c) => {
  const accounts = await getAccountsByPriority(c.env.DB, c.env.ENCRYPTION_KEY);
  if (accounts.length === 0) return c.json({ error: { message: 'No active accounts', type: 'service_error', code: 'NO_ACCOUNTS' } }, 503);

  const body = await c.req.json();
  const isStream = body.stream === true;
  let lastError = '';
  let lastErrorCode: number | string = 0;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (!account.account_id) continue;

    const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/v1/chat/completions`;
    const headers = await getAuthHeaders(account, c.env.ENCRYPTION_KEY);

    let cfResp: Response;
    try {
      // Set timeout based on stream mode
      const timeoutMs = isStream ? 600000 : 300000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        cfResp = await fetch(cfUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw fetchErr;
      }
    } catch (netErr: any) {
      // Network error (timeout, DNS, etc.) — retryable
      const errMsg = `Network error: ${netErr.message || netErr}`;
      console.warn(`[AI] Account ${account.name} ${errMsg}`);
      lastError = errMsg;
      lastErrorCode = 'NETWORK_ERROR';
      try { await addAuditLog(c.env.DB, { account_id: account.id, action: 'ai_inference', target: body.model, detail: errMsg, status: 'error' }); } catch {}
      if (i + 1 < accounts.length) continue;
      break;
    }

    if (!cfResp.ok) {
      const errorText = await cfResp.text();
      lastError = errorText;
      lastErrorCode = cfResp.status;

      if (isRetryableError(cfResp.status, errorText)) {
        if (isNeuronLimitError(errorText)) {
          console.warn(`[AI] Account ${account.name} neuron limit hit (4006), rotating`);
          await setQuota(c.env.DB, account.id, 'ai_neurons', AI_NEURON_LIMIT);
          await addAuditLog(c.env.DB, { account_id: account.id, action: 'ai_inference', target: body.model, detail: '4006 switching', status: 'error' });
        } else {
          console.warn(`[AI] Account ${account.name} upstream ${cfResp.status}, rotating`);
          try { await addAuditLog(c.env.DB, { account_id: account.id, action: 'ai_inference', target: body.model, detail: `upstream ${cfResp.status}, switching`, status: 'error' }); } catch {}
        }
        if (i + 1 < accounts.length) continue;
      }

      // Non-retryable (400, 401, 403, 404, etc.) — return immediately
      return c.json({ error: { message: errorText, type: 'upstream_error', code: String(cfResp.status) } }, cfResp.status as any);
    }

    if (isStream) {
      // Audit log is written in finally, after stream ends
      let streamStatus: 'success' | 'upstream_error' = 'success';
      let seenDone = false;

      return stream(c, async (s) => {
        try {
          const reader = cfResp.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Decode and scan for [DONE] marker
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ') && line.slice(6).trim() === '[DONE]') {
                seenDone = true;
              }
              await s.write(line + '\n');
            }
            // Write remaining complete lines
            if (buffer) {
              if (buffer.startsWith('data: ') && buffer.slice(6).trim() === '[DONE]') seenDone = true;
              await s.write(buffer);
              buffer = '';
            }
          }
        } catch (err: any) {
          streamStatus = 'upstream_error';
          console.error(`[AI] Stream error: ${err.message}`);
        } finally {
          // Always guarantee [DONE] so OpenAI SDK can return
          if (!seenDone) writeSseDone(s);
          try {
            await addAuditLog(c.env.DB, {
              account_id: account.id, action: 'ai_inference', target: body.model,
              detail: `stream /v1 (${streamStatus})`, status: streamStatus === 'success' ? 'success' : 'error',
            });
          } catch { /* audit failure should not crash response */ }
        }
      });
    }

    const data = await cfResp.json() as any;
    
    // Normalize response to match OpenAI format
    if (!data.id) data.id = `chatcmpl-${crypto.randomUUID()}`;
    if (!data.object) data.object = 'chat.completion';
    if (!data.model && body.model) data.model = body.model;
    if (!data.usage) data.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    
    await addAuditLog(c.env.DB, { account_id: account.id, action: 'ai_inference', target: body.model, detail: `tokens: ${data?.usage?.total_tokens || '?'}`, status: 'success' });
    return c.json(data);
  }

  // All accounts exhausted
  console.error(`[AI] All accounts exhausted. Last error: ${lastError}`);
  return c.json({ error: { message: 'All accounts exhausted', type: 'quota_exceeded', code: 'ALL_ACCOUNTS_EXHAUSTED', last_error: lastError || 'Unknown error' } }, 429);
});

export default app;
