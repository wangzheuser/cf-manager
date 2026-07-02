import { Router, Request, Response, NextFunction } from 'express';
import { Account } from '../models/account';
import { getAllAccounts } from '../models/account';
import { getAiUsageToday } from '../services/aiService';

const router = Router();

/**
 * GET /api/ai/usage
 * 获取所有账户的 AI 使用量统计
 */
router.get('/usage', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await getAllAccounts();
    
    // 并发查询所有账户的使用量
    const promises = accounts
      .filter(account => account.account_id)
      .map(async (account) => {
        try {
          const usage = await getAiUsageToday(account as Account);
          return {
            accountId: account.account_id,
            accountName: account.name,
            totalNeurons: usage.totalNeurons,
            models: usage.models,
          };
        } catch (err: any) {
          console.error(`[AI Usage] Failed for ${account.name}:`, err.message);
          return null; // 返回 null，后续过滤掉
        }
      });

    const results = await Promise.allSettled(promises);
    
    // 提取成功的結果，过滤掉失败的
    const result = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    res.json(result);
  } catch (err) { next(err); }
});

export default router;
