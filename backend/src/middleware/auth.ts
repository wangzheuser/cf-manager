import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiSecret) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } });
    return;
  }
  const token = authHeader.substring(7);
  if (token !== config.apiSecret) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid API secret' } });
    return;
  }
  next();
}
