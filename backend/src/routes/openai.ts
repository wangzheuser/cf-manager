import { Router, Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { selectBestAccount, getAccountsByPriority, clearCache } from '../services/accountRouter';
import { getAvailableModels } from '../services/aiService';
import { getAuthHeaders } from '../services/cfFactory';
import { createAuditLog } from '../models/auditLog';
import { setQuota } from '../models/quotaUsage';
import { proxyFetch } from '../services/proxyService';
import { appLogger } from '../services/logger';

const router = Router();

/** Cloudflare AI free tier daily neuron limit */
const AI_NEURON_LIMIT = 10000;

/** Upstream status codes that should trigger account rotation instead of immediate error. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Client-side status codes that should be returned immediately (no rotation). */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404]);

function isNeuronLimitError(text: string): boolean {
  return text.includes('4006') || text.includes('daily free allocation') || text.includes('neuron limit');
}

function writeSseDone(res: Response): void {
  if (res.writableEnded) return;
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }
  res.write('data: [DONE]\n\n');
}

function isRetryableError(status: number, errorText: string): boolean {
  if (RETRYABLE_STATUS.has(status)) return true;
  // Network-level errors (already caught as exceptions) are retryable by caller
  return isNeuronLimitError(errorText);
}

router.get('/models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await selectBestAccount('ai_neurons');
    const taskFilter = req.query.task as string | undefined;
    // Pass taskFilter directly to getAvailableModels for efficient server-side filtering
    const models = await getAvailableModels(account, taskFilter);
    
    const data = models.map((m: any) => ({
      id: m.name || m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'cloudflare',
      task: m.task?.name || m.task || undefined, // Include task info
    }));
    res.json({ object: 'list', data });
  } catch (err) { next(err); }
});

router.post('/chat/completions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if client specified a particular account
    const specifiedAccountId = req.headers['x-account-id'] as string | undefined;
    
    let accounts = await getAccountsByPriority('ai_neurons');
    
    // If client specified an account, filter to only that account
    if (specifiedAccountId && specifiedAccountId !== 'auto') {
      accounts = accounts.filter(acc => acc.account_id === specifiedAccountId);
      if (accounts.length === 0) {
        res.status(404).json({
          error: { message: `Account ${specifiedAccountId} not found or inactive`, type: 'invalid_request_error', code: 'ACCOUNT_NOT_FOUND' },
        });
        return;
      }
    }
    
    if (accounts.length === 0) {
      res.status(503).json({
        error: { message: 'No active accounts available', type: 'service_error', code: 'NO_ACCOUNTS' },
      });
      return;
    }

    const isStream = req.body.stream === true;
    let lastError = '';
    let lastErrorCode: number | string = 0;

    for (const account of accounts) {
      if (!account.account_id) continue;

      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/v1/chat/completions`;
      const headers = { 'Content-Type': 'application/json', ...getAuthHeaders(account) };

      let cfResp: any;
      try {
        // Set timeout based on stream mode
        // - Non-stream: 5 minutes (300000ms)
        // - Stream: 10 minutes (600000ms) to allow slow model inference
        const timeoutMs = isStream ? 600000 : 300000;
        cfResp = await proxyFetch(cfUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(req.body),
        }, timeoutMs);
      } catch (netErr: any) {
        // Network error (ECONNRESET, timeout, DNS, etc.) — retryable
        const errMsg = `Network error: ${netErr.message || netErr}`;
        appLogger.warn(`[AI] Account ${account.name} ${errMsg}`);
        lastError = errMsg;
        lastErrorCode = 'NETWORK_ERROR';
        createAuditLog(account.id, 'ai_inference', req.body.model, errMsg, 'error');
        if (accounts.indexOf(account) < accounts.length - 1) continue;
        break; // last account also failed
      }

      if (!cfResp.ok) {
        const errorText = await cfResp.text();
        lastError = errorText;
        lastErrorCode = cfResp.status;

        if (isRetryableError(cfResp.status, errorText)) {
          if (isNeuronLimitError(errorText)) {
            appLogger.warn(`[AI] Account ${account.name} neuron limit hit (4006), rotating`);
            setQuota(account.id, 'ai_neurons', AI_NEURON_LIMIT);
            clearCache('ai_neurons'); // Only clear AI cache, not DNS zones
            createAuditLog(account.id, 'ai_inference', req.body.model, '4006 neuron limit, switching', 'error');
          } else {
            appLogger.warn(`[AI] Account ${account.name} upstream ${cfResp.status}, rotating`);
            createAuditLog(account.id, 'ai_inference', req.body.model,
              `upstream ${cfResp.status}, switching`, 'error');
          }
          if (accounts.indexOf(account) < accounts.length - 1) continue;
        }

        // Non-retryable (400, 401, 403, 404, etc.) — return immediately
        res.status(cfResp.status).json({
          error: { message: errorText, type: 'upstream_error', code: String(cfResp.status) },
        });
        return;
      }

      if (isStream) {
        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
        res.flushHeaders();

        let seenDone = false;
        let streamStatus: 'success' | 'client_disconnected' | 'upstream_error' = 'success';

        // Detect client disconnect
        const onClose = () => {
          streamStatus = 'client_disconnected';
        };
        req.on('close', onClose);

        try {
          if (cfResp.body) {
            const body = cfResp.body as any;

            // --- Web Streams API (getReader) ---
            if (typeof body.getReader === 'function') {
              const reader = body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (res.writableEnded) { streamStatus = 'client_disconnected'; break; }

                // Parse SSE lines to detect [DONE]
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                  if (line.startsWith('data: ') && line.slice(6).trim() === '[DONE]') {
                    seenDone = true;
                  }
                }

                res.write(Buffer.from(value));
              }
              // Drain remaining buffer
              if (buffer) {
                if (buffer.startsWith('data: ') && buffer.slice(6).trim() === '[DONE]') seenDone = true;
                res.write(buffer);
              }
            }
            // --- Node.js Readable stream (pipe) ---
            else if (typeof body.pipe === 'function') {
              await new Promise<void>((resolve) => {
                const nodeStream = body as Readable;
                nodeStream.on('data', (chunk: Buffer) => {
                  if (res.writableEnded) { streamStatus = 'client_disconnected'; nodeStream.destroy(); return; }
                  const str = chunk.toString();
                  if (str.includes('[DONE]')) seenDone = true;
                  res.write(chunk);
                });
                nodeStream.on('end', () => resolve());
                nodeStream.on('error', (err: Error) => {
                  streamStatus = 'upstream_error';
                  appLogger.error(`[AI] Stream error (pipe): ${err.message}`);
                  resolve();
                });
                // Use pipeline for backpressure instead of raw pipe
                nodeStream.pipe(res, { end: false });
              });
            }
          }
        } catch (err: any) {
          streamStatus = 'upstream_error';
          appLogger.error(`[AI] Stream exception: ${err.message}`);
        } finally {
          req.off('close', onClose);
          // Always guarantee [DONE] so OpenAI SDK can return
          if (!seenDone && !res.writableEnded) {
            writeSseDone(res);
          }
          if (!res.writableEnded) res.end();
          createAuditLog(account.id, 'ai_inference', req.body.model,
            `stream via /v1 (${streamStatus})`, streamStatus === 'success' ? 'success' : 'error');
        }
      } else {
        const data = await cfResp.json() as any;
        
        // Normalize response to match OpenAI format
        if (!data.id) data.id = `chatcmpl-${crypto.randomUUID()}`;
        if (!data.object) data.object = 'chat.completion';
        if (!data.model && req.body.model) data.model = req.body.model;
        if (!data.usage) data.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        
        res.json(data);
        createAuditLog(account.id, 'ai_inference', req.body.model,
          `tokens: ${data?.usage?.total_tokens || '?'}`, 'success');
      }
      return;
    }

    // All accounts exhausted
    appLogger.error(`[AI] All accounts exhausted. Last error: ${lastError}`);
    res.status(429).json({
      error: {
        message: 'All accounts have reached daily neuron limit',
        type: 'quota_exceeded',
        code: 'ALL_ACCOUNTS_EXHAUSTED',
        last_error: lastError || 'Unknown error',
      },
    });
  } catch (err) { next(err); }
});

export default router;
