
___________________________________________________________
⚙️ FASE 6 — Operar, observar y recuperar

📖 1. La Historia (El Porqué)

Un sistema real falla. La meta no es prometer que nunca fallará, sino detectar fallos, limitar el daño y recuperar datos y servicio con un procedimiento probado.

Puntos críticos a entender en esta fase:

Observabilidad (Sentry + Telegram): Si un error 500 ocurre en producción, el equipo debe enterarse en segundos, no cuando el cliente llama. Implementamos un sistema de alertas con cooldown (anti-spam) para no saturar el canal.
Backups con Restore Drill: Un backup no es válido solo porque el archivo se creó. Debe poder restaurarse. Escribimos un manifest.json con conteos y hashes SHA-256 para verificar que los datos restaurados son idénticos a los originales.
Cron de órdenes huérfanas: Si un usuario inicia el checkout pero no paga, el stock queda reservado. Un Cron job cancelará esas órdenes cada hora y devolverá el stock, garantizando que el proceso sea idempotente (no devolver el stock dos veces si el servidor se reinicia).
Cola de emails (BullMQ): Enviar correos puede tardar. Si el SMTP falla, no podemos bloquear la petición web. Usamos una cola con reintentos exponenciales (3s, 6s, 12s) para asegurar la entrega.
Readiness vs Liveness: /health dice si el proceso vive. /ready dice si la base de datos está conectada y el sistema puede procesar tráfico.
📋 2. El Checklist (El Qué)

□ Dependencias: Instalar @sentry/node, @sentry/profiling-node, node-cron, bullmq, @aws-sdk/client-s3 (backend) y @sentry/react (frontend).
□ Sentry Backend: Crear instrument.ts y llamarlo al inicio de server.ts.
□ Sentry Frontend: Crear instrument.ts y configurar main.tsx.
□ Alertas: Crear alert.service.ts con cooldown. Integrar en el error handler y /ready.
□ Backup: Crear scripts/backup.ts (genera manifest SHA-256).
□ Restore Drill: Crear scripts/restore.ts y restore-drill.yml en CI.
□ Cron: Implementar expireStaleOrders en order.service.ts y agendar en server.ts.
□ Colas: Crear queues/email.queue.ts (Queue + Worker con backoff).
□ Runbook: Crear docs/RUNBOOK.md con 5 incidentes documentados.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 6.1: Dependencias y Sentry

Instalación:
___________________________________________________________
cd server
npm install @sentry/node @sentry/profiling-node node-cron bullmq @aws-sdk/client-s3
cd ../client
npm install @sentry/react
___________________________________________________________
server/src/instrument.ts
___________________________________________________________
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';
import { AppError } from './utils/AppError.js';

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    integrations: [new ProfilingIntegration()],
    beforeSend(event) {
      // Ignorar errores operacionales controlados
      if (event.exception?.values?.[0]?.type === 'AppError') return null;
      
      // Scrub PII
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
}
___________________________________________________________
Actualizar server/src/server.ts (Debe ser lo PRIMERO)
___________________________________________________________
import './instrument.js'; // <-- PRIMERO
import 'dotenv/config';
import { initSentry } from './instrument.js';
// ... resto de imports

initSentry();
// ... bootstrap ...
___________________________________________________________
server/src/app.ts (Sentry Error Handler)
___________________________________________________________
import * as Sentry from '@sentry/node';

// Después de todas las rutas, antes del error handler global:
Sentry.setupExpressErrorHandler(app);
___________________________________________________________
Paso 6.2: Alertas por Telegram (Cooldown)

server/src/services/alert.service.ts
___________________________________________________________
import { logger } from '../config/logger.js';

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? 3_600_000); // 1 hora

export async function sendAlert(key: string, message: string): Promise<void> {
  const last = cooldowns.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  cooldowns.set(key, Date.now());

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    logger.warn({ key, message }, 'Telegram no configurado');
    return;
  }
  
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `🚨 ${key}: ${message}` }),
    });
  } catch (err) {
    logger.error({ err }, 'Alert send failed');
  }
}
___________________________________________________________
Actualizar server/src/app.ts (Error Handler)
___________________________________________________________
app.use(async (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.statusCode : 500;
  if (status >= 500) await sendAlert('error:5xx', `${err.message} en ${_req.method} ${_req.path}`);
  
  logger.error({ err }, 'Request failed');
  res.status(status).json({ code: err instanceof AppError ? err.code : 'INTERNAL', message: 'Error interno' });
});
___________________________________________________________
Paso 6.3: Cron de Órdenes Huérfanas

Actualizar server/src/services/order.service.ts
___________________________________________________________
export async function expireStaleOrders(hoursOld = 24): Promise<number> {
  const cutoff = new Date(Date.now() - hoursOld * 3_600_000);
  const staleOrders = await OrderModel.find({ 
    status: 'pending', 
    paymentStatus: 'unpaid', 
    createdAt: { $lt: cutoff } 
  });

  let count = 0;
  for (const order of staleOrders) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Reclamar la orden de forma atómica (evita doble restauración)
        const claimed = await OrderModel.findOneAndUpdate(
          { _id: order._id, status: 'pending', paymentStatus: 'unpaid' },
          { $set: { status: 'cancelled' } },
          { new: true, session }
        );
        if (!claimed) return; // Otra instancia ya la procesó

        // Restaurar stock
        for (const item of order.items) {
          await ProductModel.findByIdAndUpdate(
            item.product, 
            { $inc: { stock: item.quantity } }, 
            { session }
          );
        }
        count++;
      });
    } finally { 
      await session.endSession(); 
    }
  }
  return count;
}
___________________________________________________________
Actualizar server/src/server.ts (Agendar Cron)
___________________________________________________________
import cron from 'node-cron';
import { expireStaleOrders } from './services/order.service.js';
import { sendAlert } from './services/alert.service.js';

cron.schedule('0 * * * *', async () => {
  try {
    const expired = await expireStaleOrders(24);
    if (expired > 0) console.log(`Expiradas: ${expired} órdenes`);
  } catch (err) {
    await sendAlert('cron:expire-fail', (err as Error).message);
  }
});
___________________________________________________________
Paso 6.4: Cola de Correos (BullMQ)

server/src/queues/email.queue.ts
___________________________________________________________
import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { emailService } from '../services/email.service.js';

export const emailQueue = new Queue('email', { connection: redis });

export async function enqueueEmail(job: { to: string; subject: string; html: string }) {
  await emailQueue.add('send', job, {
    attempts: 3, 
    backoff: { type: 'exponential', delay: 3000 }, // 3s, 6s, 12s
    removeOnComplete: 100, 
    removeOnFail: 500,
  });
}

export function startEmailWorker() {
  const worker = new Worker('email', async (job) => {
    await emailService.sendMail(job.data.to, job.data.subject, job.data.html);
  }, { connection: redis });

  worker.on('failed', (job, err) => console.error(`Email failed ${job?.id}:`, err));
  return worker;
}
___________________________________________________________
Actualizar server/src/services/email.service.ts
___________________________________________________________
import { enqueueEmail } from '../queues/email.queue.js';

export const emailService = {
  async sendMail(to: string, subject: string, html: string) {
    // Este es el que usa el Worker
    const transporter = nodemailer.createTransport({/* ... */});
    await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
  },

  async sendOrderConfirmation(order: any) {
    await enqueueEmail({
      to: order.userEmail ?? 'customer@example.com',
      subject: `Pedido ${order.id} confirmado`,
      html: `<h1>Gracias por tu pedido</h1>`,
    });
  },
};
___________________________________________________________
Actualizar server/src/server.ts (Arrancar Worker y Graceful Shutdown)
___________________________________________________________
import { startEmailWorker } from './queues/email.queue.js';

const worker = startEmailWorker();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await worker.close(); // Cerrar cola
  await disconnectDatabase();
  process.exit(0);
};
___________________________________________________________
Paso 6.5: Backups y Restore Drill

server/src/scripts/backup.ts
___________________________________________________________
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import 'dotenv/config';

const execP = promisify(exec);

const s3 = new S3Client({
  region: process.env.BACKUP_S3_REGION,
  credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY!, secretAccessKey: process.env.BACKUP_S3_SECRET_KEY! },
});

async function sha256File(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function runBackup() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpDir = `/tmp/backup-${ts}`;
  
  await execP(`mongodump --uri="${process.env.MONGODB_URI}" --out=${dumpDir}`);
  await execP(`tar -czf ${dumpDir}.tar.gz -C /tmp backup-${ts}`);

  const collections = await mongoose.connection.db!.listCollections().toArray();
  const manifest: any = { timestamp: ts, database: mongoose.connection.db!.databaseName, collections: [], s3Key: `backups/${ts}.tar.gz` };

  for (const col of collections) {
    const count = await mongoose.connection.db!.collection(col.name).countDocuments();
    const file = path.join(dumpDir, `${mongoose.connection.db!.databaseName}/${col.name}.bson`);
    let sha = '';
    try { sha = await sha256File(file); } catch {}
    manifest.collections.push({ name: col.name, count, sha256: sha });
  }

  await s3.send(new PutObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: manifest.s3Key, Body: await fs.readFile(`${dumpDir}.tar.gz`), ServerSideEncryption: 'AES256' }));
  await s3.send(new PutObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: `backups/${ts}.manifest.json`, Body: JSON.stringify(manifest, null, 2) }));

  await fs.rm(dumpDir, { recursive: true, force: true });
  await fs.rm(`${dumpDir}.tar.gz`, { force: true });
  await mongoose.disconnect();
  console.log('Backup OK', manifest.s3Key);
}
runBackup().catch(e => { console.error(e); process.exit(1); });
___________________________________________________________
Paso 6.6: Runbook de Incidentes

docs/RUNBOOK.md
___________________________________________________________
# Runbook de Incidentes - e_commerce_01

## 1. El sitio está caído (Error 502/504)
- **Síntoma:** El navegador no carga, los health checks fallan.
- **Diagnóstico:** Revisar logs del servidor (`docker logs` o panel de Render). Verificar estado de MongoDB Atlas y Redis.
- **Mitigación:** Reiniciar el servicio. Si Mongo está caído, restaurar desde el último backup (ver sección de Restore). Si el tráfico es alto, escalar instancias.
- **Escalación:** Avisar al líder técnico.

## 2. Los pagos no procesan (Error 500 en Checkout)
- **Síntoma:** Usuarios reportan que al pagar no avanzan.
- **Diagnóstico:** Revisar los logs de Stripe en el dashboard. Verificar que el `STRIPE_SECRET_KEY` sea válido. Comprobar que el Webhook esté recibiendo eventos.
- **Mitigación:** Si Stripe está caído, mostrar banner de mantenimiento. Si es un error de código, hacer rollback al último deploy estable.

## 3. Las búsquedas fallan (Error 500 en /api/products?q=)
- **Síntoma:** El filtro de búsqueda devuelve error.
- **Diagnóstico:** Verificar si Meilisearch (Fase 9) está caído.
- **Mitigación:** El código debe tener un *fallback* a la búsqueda por Regex en MongoDB (ya implementado). Si falla Redis, la app debe seguir funcionando.

## 4. La base de datos no responde
- **Síntoma:** `/ready` devuelve 503, todas las rutas fallan con timeout.
- **Diagnóstico:** Revisar conexión a MongoDB Atlas. Verificar límites de conexión.
- **Mitigación:** Si es un fallo de red temporal, esperar. Si el disco está lleno, escalar el cluster.

## 5. Cobros duplicados (Usuarios reportan doble cargo)
- **Síntoma:** El usuario fue cobrado dos veces.
- **Diagnóstico:** Buscar en MongoDB órdenes con el mismo `userId` y `total` en fechas cercanas. Revisar si el `Idempotency-Key` falló.
- **Mitigación:** Hacer un reembolso manual desde Stripe. Si el problema es sistémico, revisar el código del checkout (debe estar usando `findOneAndUpdate` con idempotencia).
___________________________________________________________
🚦 4. Gate 6 (Validación)

No avances a la Fase 7 hasta que se cumplan TODOS estos puntos:

□ Sentry Backend: Forzar un throw new Error() en un endpoint. Verificar que el error llega a Sentry con el stack trace y sin PII (sin tokens ni cookies).
□ Sentry Frontend: Hacer un console.error en React. Verificar que llega a Sentry.
□ Alertas con Cooldown: Forzar 3 errores 500 seguidos. Solo debe llegar 1 mensaje a Telegram (el cooldown de 1h funciona).
□ Cron de Huérfanas: Crear una orden pending con fecha de creación mayor a 24h. Ejecutar el cron (npm run cron o esperar la hora). Verificar que la orden pasa a cancelled y el stock se restaura en Mongo.
□ Cola de Emails: Registrar un usuario. El worker debe procesar el envío. Simular que SMTP falla y verificar que reintenta 3 veces antes de fallar definitivamente.
□ Backup: Ejecutar npm run backup (script). Verificar que en S3 hay un .tar.gz y un .manifest.json con counts y sha256.
□ Restore Drill: Ejecutar npm run restore <s3-key>. El script debe restaurar la DB, comparar los counts del manifest y terminar sin errores (debe coincidir).
□ Runbook: Revisar docs/RUNBOOK.md. Al menos un desarrollador distinto al que lo escribió debe entender qué hacer ante una caída de Mongo.