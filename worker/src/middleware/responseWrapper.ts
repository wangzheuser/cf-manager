import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';

/**
 * Check if the response body is an OpenAI-compatible format
 * OpenAI responses have specific fields like: object, model, choices, id, etc.
 */
function isOpenAIFormat(body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  
  // OpenAI /models response
  if (body.object === 'list' && Array.isArray(body.data)) return true;
  
  // OpenAI /chat/completions response
  if (body.id && body.object === 'chat.completion') return true;
  if (body.id && body.object === 'chat.completion.chunk') return true;
  if (Array.isArray(body.choices)) return true;
  
  // OpenAI error format
  if (body.error && typeof body.error === 'object' && body.error.message) return true;
  
  return false;
}

export const responseWrapper = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  await next();

  const res = c.res;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return;

  const status = res.status;
  let body: any;
  try {
    body = await res.clone().json();
  } catch {
    return;
  }

  // Skip wrapping if it's an OpenAI-compatible response
  if (isOpenAIFormat(body)) return;

  let wrapped: any;

  if (body && typeof body === 'object' && body.success !== undefined) {
    if (body.data !== undefined || body.error !== undefined) {
      return;
    }
    const { success, ...rest } = body;
    wrapped = success
      ? { success: true, data: Object.keys(rest).length > 0 ? rest : undefined }
      : { success: false, error: Object.keys(rest).length > 0 ? rest : undefined };
  } else if (status >= 400) {
    wrapped = body?.error
      ? { success: false, error: body.error }
      : { success: false, error: body };
  } else {
    wrapped = { success: true, data: body };
  }

  c.res = new Response(JSON.stringify(wrapped), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
});
