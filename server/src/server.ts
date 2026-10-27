import 'dotenv/config';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './config/logger.js';

async function bootstrap(): Promise<void> {
    await connectDatabase(process.env.MONGODB_URI!);
    const app = await createApp();
    const server = app.listen(process.env.PORT ?? 3000, () => logger.info('Server on :3000'));

    const shutdown = async (signal: string)=> {
        logger.info({ signal }, 'Shutting down');
        server.close();
        await disconnectDatabase();
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { logger.error({err}, 'Bootstrap failed');
process.exit(1); });