import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { Agent } from 'http';
import nodeFetch from 'node-fetch';
import { config } from '../config';
import { getSetting, setSetting } from '../db';

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: any;
}

let cachedAgent: Agent | undefined;
let cachedUrl = '';

function isSocks(url: string): boolean {
  return /^socks[45h]?:\/\//i.test(url);
}

export function isProxyEnabled(): boolean {
  const val = getSetting('proxy_enabled');
  if (val !== undefined) return val === '1';
  return !!config.proxyUrl;
}

export function setProxyEnabled(enabled: boolean): void {
  setSetting('proxy_enabled', enabled ? '1' : '0');
  cachedAgent = undefined;
  cachedUrl = '';
}

export function getProxyUrl(): string {
  const dbVal = getSetting('proxy_url');
  if (dbVal !== undefined) return dbVal;
  return config.proxyUrl;
}

export function setProxyUrl(url: string): void {
  setSetting('proxy_url', url);
  cachedAgent = undefined;
  cachedUrl = '';
}

export function getHttpAgent(): Agent | undefined {
  if (!isProxyEnabled()) return undefined;
  const url = getProxyUrl();
  if (!url) return undefined;
  if (url === cachedUrl && cachedAgent) return cachedAgent;

  cachedAgent = isSocks(url)
    ? new SocksProxyAgent(url, { timeout: 30000 })
    : new HttpsProxyAgent(url, { timeout: 30000 });
  cachedUrl = url;
  return cachedAgent;
}

export async function proxyFetch(input: string | URL, init?: any, timeoutMs: number = 300000): Promise<FetchResponse> {
  const agent = getHttpAgent();
  
  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    if (!agent) {
      const response = await fetch(input, { ...init, signal: controller.signal }) as unknown as FetchResponse;
      clearTimeout(timeoutId);
      return response;
    }

    const doFetch = () => nodeFetch(input.toString(), { ...init, agent, timeout: timeoutMs });
    const result = await doFetch() as unknown as FetchResponse;
    clearTimeout(timeoutId);
    return result;
  } catch (err: any) {
    clearTimeout(timeoutId);
    
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
      cachedAgent = undefined;
      cachedUrl = '';
      const newAgent = getHttpAgent();
      // Retry with new agent
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
      try {
        if (!newAgent) {
          const response = await fetch(input, { ...init, signal: retryController.signal }) as unknown as FetchResponse;
          clearTimeout(retryTimeoutId);
          return response;
        }
        const result = await nodeFetch(input.toString(), { ...init, agent: newAgent, timeout: timeoutMs }) as unknown as FetchResponse;
        clearTimeout(retryTimeoutId);
        return result;
      } catch (retryErr) {
        clearTimeout(retryTimeoutId);
        throw retryErr;
      }
    }
    
    // Handle timeout error
    if (err.name === 'AbortError' || err.type === 'request-timeout') {
      const timeoutErr = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    
    throw err;
  }
}

export function buildCurlCommand(url: string, init?: any): string {
  const proxyUrl = getProxyUrl();
  const parts = ['curl -s'];
  if (proxyUrl) parts.push(`-x '${proxyUrl}'`);
  if (init?.method && init.method !== 'GET') parts.push(`-X ${init.method}`);
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      const val = k.toLowerCase() === 'authorization' ? (v as string).replace(/^(Bearer\s+).+/, '$1***') : v;
      parts.push(`-H '${k}: ${val}'`);
    }
  }
  if (init?.body) {
    const body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    const truncated = body.length > 500 ? body.substring(0, 500) + '...' : body;
    parts.push(`-d '${truncated.replace(/'/g, "'\\''")}'`);
  }
  parts.push(`'${url}'`);
  return parts.join(' \\\n  ');
}

export async function testProxyConnection(proxyUrl: string): Promise<{ latency_ms: number; status: number }> {
  const agent = isSocks(proxyUrl)
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);

  const start = Date.now();
  const resp = await nodeFetch('https://api.cloudflare.com/client/v4/ips', {
    agent,
    timeout: 10000,
  });
  const latency = Date.now() - start;

  if (!resp.ok) {
    throw new Error(`Upstream returned HTTP ${resp.status}`);
  }
  return { latency_ms: latency, status: resp.status };
}
