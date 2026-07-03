import { Router } from 'express';
import { handleBrowserRender } from '../services/browserRenderHandler';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { url, mode, accountId } = req.body;
    const { status, body } = await handleBrowserRender({ url, mode, accountId });
    res.status(status).json(body.result || body);
  } catch (err) { next(err); }
});

export default router;
