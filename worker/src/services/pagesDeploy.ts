import type { Account } from '../db/models';
import { blake3 } from '@noble/hashes/blake3';
import { cfFetch, cfFetchRaw } from './cfApi';

// 演示/特殊文件：不进 manifest，单独作为 multipart 字段上传
const SPECIAL_FILES = new Set([
  '_worker.js', '_worker.bundle', '_headers', '_redirects',
  '_routes.json', 'functions-filepath-routing-config.json',
]);

// ============ ZIP 解包（纯 Web API，兼容 workerd，无需外部 zip 库）============
export async function extractZipFiles(zipData: Uint8Array): Promise<Array<{ path: string; buffer: Uint8Array }>> {
  const files: Array<{ path: string; buffer: Uint8Array }> = [];
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);

  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) return files;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);
  let pos = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compression = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(zipData.slice(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;

    let fileData: Uint8Array;
    if (compression === 0) {
      fileData = zipData.slice(dataStart, dataStart + uncompSize);
    } else if (compression === 8) {
      const compressed = zipData.slice(dataStart, dataStart + compSize);
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compressed);
      writer.close();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      fileData = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { fileData.set(chunk, offset); offset += chunk.length; }
    } else {
      continue;
    }

    const cleanPath = name.replace(/\\/g, '/').replace(/^\/+/, '');
    files.push({ path: cleanPath, buffer: fileData });
  }
  return files;
}

// ============ BLAKE3 资产哈希（与 backend workerService.computePageAssetHash / wrangler 同款）============
//   hash = blake3(base64(content) + extension).hex().slice(0, 32)
// Cloudflare 资产存储按此算法内容寻址，必须与 backend 保持一致，否则运行时按 hash 取内容失败 → 404。
// 普通 web 资源的 MIME 类型（与 backend getContentType 一致）。
// Cloudflare Pages 静态托管按扩展名推断响应 Content-Type，上传时带正确类型更稳妥。
function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
    mjs: 'application/javascript', json: 'application/json', xml: 'application/xml',
    txt: 'text/plain', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', ico: 'image/x-icon', webp: 'image/webp',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject', mp4: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', pdf: 'application/pdf',
    wasm: 'application/wasm', map: 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

function pageAssetExtname(p: string): string {
  const base = p.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function computePageAssetHash(buffer: Uint8Array, filePath: string): Promise<string> {
  const base64Contents = uint8ToBase64(buffer);
  const extension = pageAssetExtname(filePath).substring(1);
  // 纯 JS BLAKE3：输入与 backend（hash-wasm blake3）完全一致 = UTF-8(base64(content) + extension)
  const input = new TextEncoder().encode(base64Contents + extension);
  const hashBytes = blake3(input);
  // 与 backend 一致：取完整 BLAKE3 哈希的前 32 个 hex 字符（= 前 16 字节）
  return bytesToHex(hashBytes.slice(0, 16));
}

// ============ 统一 Pages 部署入口 ============
// 所有 Pages 部署（手动 / 批量 / Store）都走这里，避免多份不一致的实现。
// 与 backend services/workerService.deployPages 行为一致：
//   - 普通资源路径加前导斜杠（"/index.html"）
//   - manifest key 与 multipart 字段名同步且一致
//   - 哈希用 BLAKE3
export interface DeployPageFile { path: string; buffer: Uint8Array; }

export interface DeployPagesOptions {
  skipCreateProject?: boolean;
  productionBranch?: string;
  branch?: string;
  commitMessage?: string;
}

export async function deployPages(
  account: Account,
  encryptionKey: string,
  name: string,
  files: DeployPageFile[],
  opts: DeployPagesOptions = {},
): Promise<any> {
  if (!opts.skipCreateProject) {
    try {
      await cfFetch(account, `/accounts/${account.account_id}/pages/projects`, encryptionKey, {
        method: 'POST',
        body: JSON.stringify({ name, production_branch: opts.productionBranch || 'main' }),
      });
    } catch (e: any) {
      if (!e.body?.includes('already exists') && e.status !== 409) throw e;
    }
  }

  // 与 backend 一致：空文件时返回 project 对象（而非 null），便于调用方拿到项目信息。
  if (files.length === 0) {
    const project = await cfFetch(account, `/accounts/${account.account_id}/pages/projects/${name}`, encryptionKey);
    return project.result || project;
  }

  const manifest: Record<string, string> = {};
  const assetFiles: Array<{ path: string; buffer: Uint8Array; contentType: string }> = [];
  const specialFiles: Array<{ name: string; buffer: Uint8Array; contentType: string }> = [];

  // 第一遍：遍历文件、计算哈希并分类（不操作 FormData，以便后面按 backend 顺序构建 multipart）。
  for (const f of files) {
    const basename = f.path.split('/').pop() || f.path;
    if (SPECIAL_FILES.has(basename) && !f.path.includes('/')) {
      specialFiles.push({ name: basename, buffer: f.buffer, contentType: getContentType(basename) });
    } else {
      const assetPath = '/' + f.path;
      const hash = await computePageAssetHash(f.buffer, assetPath);
      manifest[assetPath] = hash;
      assetFiles.push({ path: assetPath, buffer: f.buffer, contentType: getContentType(assetPath) });
    }
  }

  const deployForm = new FormData();

  // multipart 字段顺序与 backend SDK 的 createForm 一致：
  //   account_id → manifest → branch → commit_hash → commit_message → commit_dirty → [文件] → [特殊文件]
  // Cloudflare API 可能对顺序敏感（manifest 必须在文件之前才能正确关联）。
  deployForm.append('account_id', account.account_id);
  deployForm.append('manifest', JSON.stringify(manifest));
  deployForm.append('branch', opts.branch || 'main');
  deployForm.append('commit_hash', 'direct-upload');
  deployForm.append('commit_message', opts.commitMessage || 'Deploy via CF Manager');
  deployForm.append('commit_dirty', 'false');

  for (const af of assetFiles) {
    deployForm.append(af.path, new Blob([af.buffer], { type: af.contentType }), af.path);
  }

  for (const sf of specialFiles) {
    deployForm.append(sf.name, new Blob([sf.buffer], { type: sf.contentType }), sf.name);
  }

  const resp = await cfFetchRaw(
    account,
    `/accounts/${account.account_id}/pages/projects/${name}/deployments`,
    encryptionKey,
    { method: 'POST', body: deployForm },
  );
  const result = await resp.json();
  if (!resp.ok) throw new Error(`Pages deploy failed: ${JSON.stringify(result)}`);
  return result;
}
