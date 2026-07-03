import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  apiSecret: process.env.API_SECRET || '',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cf-manager.db'),
  proxyUrl: process.env.PROXY_URL || '',
  demoAccountIds: process.env.DEMO_ACCOUNT_IDS || '',
};
