import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './config/redis.js';
import { logger } from './config/logger.js';
import { AppError } from './utils/AppError.js';

export async function createApp(): Promise<express.Express> {
  const app = express();
  
  app.use(helmet());
  app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
  app.use(cookieParser(process.env.COOKIE_SECRET));

  const limiter = rateLimit({
    windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false,
    store: new RedisStore({ 
      sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as any 
    }),
  });
  app.use('/api', limiter);
  app.use(express.json({ limit: '1mb' }));

  // AQUÍ ESTABA EL ERROR. Ahora acepta /health y /api/health
  app.get(['/health', '/api/health'], (_req, res) => res.json({ status: 'ok' }));
  
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Ruta no encontrada' }));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    logger.error({ err }, 'Unhandled error');
    res.status(status).json({ code: 'INTERNAL', message: 'Error interno' });
  });
  
  return app;
}