Fase 6 Granular: Operación Confiable

Esta fase te permite dormir sin miedo. Al terminarla, si algo se rompe, te enteras antes que tus clientes; si una orden queda huérfana, se limpia sola; si el email falla, no bloquea el checkout.

Lo que construiremos:

#	Componente	Resultado
1	Sentry (backend + frontend)	Errores con contexto, stack legible y alertas
2	Alertas activas (Telegram)	Notificación en < 30s de errores 5xx y caídas
3	Backups automáticos con mongodump + S3/R2	Restore probado y documentado
4	Uptime monitoring externo (Better Stack / UptimeRobot)	Sabes si el sitio está caído antes que el cliente
5	Cron de órdenes huérfanas	Órdenes pending > 24h se cancelan y restauran stock
6	Cola de emails con BullMQ + Redis	Emails con reintentos, sin bloquear requests
📦 6.0 Dependencias y Variables de Entorno

6.0.1 Instalación

Backend:

bash
cd server

# Sentry
npm install @sentry/node @sentry/profiling-node

# Cron + colas
npm install node-cron bullmq ioredis

# Backups (S3)
npm install @aws-sdk/client-s3
Frontend:

bash
cd client
npm install @sentry/react
npm install --save-dev @sentry/vite-plugin
6.0.2 Ampliar server/.env.example

env
# ─── Sentry ──────────────────────────────────────────────
SENTRY_DSN=https://xxxx@o123456.ingest.sentry.io/123456
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1

# ─── Alertas (Telegram) ──────────────────────────────────
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=-100123456789
ALERT_COOLDOWN_MS=3600000

# ─── Redis (BullMQ) ──────────────────────────────────────
REDIS_URL=redis://127.0.0.1:6379

# ─── Backups ─────────────────────────────────────────────
BACKUP_S3_BUCKET=e_commerce_01-backups
BACKUP_S3_REGION=us-east-1
BACKUP_RETENTION_DAYS=30
BACKUP_DIR=/tmp/e_commerce_01-backups
Añade también VITE_SENTRY_DSN en client/.env.example:

env
VITE_SENTRY_DSN=https://xxxx@o123456.ingest.sentry.io/123456
VITE_SENTRY_ENVIRONMENT=production
6.0.3 Añadir Redis al docker-compose.yml

yaml
# docker-compose.yml — añade el servicio redis
services:
  # ...mongo, server, client...
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: ["redis-server", "--appendonly", "yes"]

volumes:
  mongo-data:
  uploads-data:
  redis-data: # nuevo
Y en el servicio server, añade la dependencia y la variable:

yaml
  server:
    # ...
    environment:
      # ...
      REDIS_URL: redis://redis:6379
    depends_on:
      mongo-init:
        condition: service_completed_successfully
      redis:
        condition: service_started
🐛 6.1 Sentry: Errores con Contexto

Sentry captura automáticamente errores no manejados y te muestra: stack trace legible, breadcrumbs (últimas acciones del usuario), request ID, usuario afectado y release.

# Paso 6.1.1: Backend — archivo instrument.js

Crítico: Sentry debe inicializarse antes de importar cualquier módulo instrumentado (Express, Mongo, etc.). Si lo inicializas después, el auto-instrumentation no funciona.

Crea server/src/instrument.js:

javascript
// server/src/instrument.js
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  release: process.env.npm_package_version || '1.0.0',

  integrations: [
    nodeProfilingIntegration(),
  ],

  // ─── Sampling ────────────────────────────────────────
  // 100% de errores, 10% de transacciones (rendimiento)
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
  profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE) || 0.1,

  // ─── Privacidad (GDPR) ──────────────────────────────
  beforeSend(event) {
    // Nunca enviar headers sensibles
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
    // Nunca enviar body con password
    if (event.request?.data?.password) {
      event.request.data.password = '[REDACTED]';
    }
    return event;
  },

  // Ignorar errores esperados del negocio (4xx controlados)
  ignoreErrors: [
    'Token no proporcionado',
    'Credenciales inválidas',
    'Stock insuficiente',
  ],
});
Sentry v8+: Sentry.Handlers.requestHandler() ya no existe. El error handler de Express se configura con Sentry.setupExpressErrorHandler(app) después de las rutas y antes del error handler global.
# Paso 6.1.2: Backend — cargar instrument.js primero en server.js

Modifica server/src/server.js:

javascript
// server/src/server.js
import './instrument.js'; // 🔑 DEBE ser el primer import
import 'dotenv/config';
import app from './app.js';
// ...resto igual
Y en app.js, añade el error handler de Sentry antes del tuyo:

javascript
// server/src/app.js (al final, después de las rutas y antes del error handler global)
import * as Sentry from '@sentry/node';
import './instrument.js'; // asegura que Sentry está inicializado

// ...rutas...

// Handler de Sentry (captura errores con contexto de request)
Sentry.setupExpressErrorHandler(app);

// Tu error handler global (sigue funcionando para formatear respuestas)
app.use((err, req, res, next) => {
  // Si es error operacional (AppError), no lo enviamos a Sentry como crítico
  if (err.isOperational) {
    // Sentry ya lo capturó si fue 5xx; los 4xx se ignoran por ignoreErrors
  }
  // ...resto del handler...
});
¿Qué captura Sentry automáticamente?

Errores lanzados en controladores o servicios (throw new Error)
Rechazos de promesas no manejados
Excepciones en middlewares de Express
Errores 5xx con su stack completo
¿Qué NO captura?

Errores 4xx esperados (401, 403, 404, 409) — se filtran con ignoreErrors y porque son operacionales.
# Paso 6.1.3: Frontend — instrument.js y ErrorBoundary

Crea client/src/instrument.js:

javascript
// client/src/instrument.js
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true, // privacidad: no grabar texto del usuario
      blockAllMedia: true,
    }),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0, // 100% de sesiones con error

  beforeSend(event) {
    // No enviar errores de red 4xx esperados
    const status = event.exception?.values?.[0]?.mechanism?.handled;
    if (status === false) return null;
    return event;
  },
});
Importa instrument.js antes que cualquier otro módulo en client/src/main.jsx:

jsx
// client/src/main.jsx
import './instrument.js'; // 🔑 primero
import React from 'react';
import ReactDOM from 'react-dom/client';
// ...resto
Envuelve <App /> con Sentry.withErrorBoundary en main.jsx:

jsx
// client/src/main.jsx
import * as Sentry from '@sentry/react';

function ErrorFallback({ error, resetError }) {
  return (
    <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
      <h1>Algo salió mal</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        El equipo técnico ha sido notificado automáticamente.
      </p>
      <button onClick={resetError} className="btn btn--primary">
        Reintentar
      </button>
    </div>
  );
}

const AppWithSentry = Sentry.withErrorBoundary(App, {
  fallback: ErrorFallback,
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppWithSentry />
  </React.StrictMode>
);
# Paso 6.1.4: Frontend — Source Maps para stack traces legibles

Sin source maps, Sentry te muestra a.js:1:23452 en lugar del nombre real del componente y línea.

Configura client/vite.config.js:

javascript
// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Solo en build de producción
    mode === 'production' && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'], // borra los .map tras subir
      },
    }),
  ],
  build: {
    sourcemap: true, // necesario para que el plugin los genere
  },
  // ...server proxy...
}));
Añade las variables en tu CI (GitHub Secrets): SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN.

✅ Checklist Sentry:

□ Error 500 en backend → aparece en Sentry con req.id, ruta y usuario.
□ Error en componente React → aparece con nombre del componente y línea exacta.
□ authorization y cookie aparecen como [REDACTED].
□ Los 401/404 no generan entradas en Sentry.
□ El source map subido permite ver CheckoutPage.jsx:47 (no a.js:1).
🔔 6.2 Alertas Activas con Telegram

Sentry te avisa en su dashboard. Pero si no lo miras, no te enteras. Las alertas activas te persiguen hasta que las ves.

# Paso 6.2.1: Crear un bot de Telegram

Abre Telegram y busca @BotFather.
Envía /newbot y sigue las instrucciones. Obtendrás un TELEGRAM_BOT_TOKEN.
Crea un grupo (o usa uno existente) y añade el bot.
Para obtener el chat_id del grupo: envía un mensaje al grupo y visita:

text
https://api.telegram.org/bot<TOKEN>/getUpdates
Busca "chat":{"id":-100...}. Ese es tu TELEGRAM_CHAT_ID.
# Paso 6.2.2: Servicio de alertas (server/src/services/alert.service.js)

javascript
// server/src/services/alert.service.js
import logger from '../config/logger.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS) || 3600000; // 1h

// Anti-spam: no enviar la misma alerta más de 1 vez por hora
const lastSent = new Map();

/**
 * Envía una alerta a Telegram con throttling.
 * @param {string} key - Identificador único (ej. "error:5xx", "ready:down")
 * @param {string} message - Texto (soporta Markdown)
 */
export async function sendAlert(key, message) {
  if (!BOT_TOKEN || !CHAT_ID) {
    logger.warn('Telegram no configurado, alerta omitida');
    return;
  }

  const now = Date.now();
  const last = lastSent.get(key);
  if (last && now - last < COOLDOWN_MS) {
    logger.debug({ key }, 'Alerta en cooldown, omitida');
    return;
  }
  lastSent.set(key, now);

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, 'Error enviando alerta a Telegram');
    } else {
      logger.info({ key }, 'Alerta enviada a Telegram');
    }
  } catch (err) {
    logger.error({ err }, 'Error de red enviando alerta');
  }
}
# Paso 6.2.3: Integrar alertas en el error handler global

En server/src/app.js, dentro de tu error handler global, después de loguear:

javascript
import { sendAlert } from './services/alert.service.js';

app.use((err, req, res, next) => {
  // ...tu lógica existente de formateo...

  // ─── Alerta solo para errores 5xx (no operacionales) ──
  if (statusCode >= 500) {
    sendAlert(
      'error:5xx',
      `🔴 *Error 5xx en producción*\n` +
      `Ruta: \`${req.method} ${req.originalUrl}\`\n` +
      `Mensaje: ${err.message}\n` +
      `reqId: \`${req.id}\``
    ).catch(() => {});
  }

  // ...respuesta...
});
# Paso 6.2.4: Alerta cuando /ready falla

En el endpoint /ready de health.routes.js:

javascript
// server/src/routes/health.routes.js
import { sendAlert } from '../services/alert.service.js';

router.get('/ready', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  if (dbState !== 1) {
    sendAlert('ready:down', '🔴 *DB desconectada* — /ready devuelve 503').catch(() => {});
    return res.status(503).json({ status: 'not_ready', db: 'disconnected' });
  }
  res.json({ status: 'ready', db: 'connected' });
});
# Paso 6.2.5: Alerta de cron fallido

En el cron de órdenes huérfanas (sección 6.5), envuelve el job en try/catch y envía alerta si falla.

✅ Checklist alertas:

□ Al lanzar un throw new Error('test') en un controlador → llega alerta a Telegram en < 30s.
□ Al repetir el mismo error 5 veces → solo llega 1 alerta (cooldown).
□ Al parar Mongo → alerta de /ready tras 3 checks fallidos.
□ La alerta incluye ruta, mensaje y reqId.
💾 6.3 Backups Automáticos con mongodump + S3

Regla de oro: Un backup que nunca se ha restaurado no es un backup.

# Paso 6.3.1: Script de backup (server/src/scripts/backup.js)

javascript
// server/src/scripts/backup.js
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import 'dotenv/config';

const execAsync = promisify(exec);

const s3 = new S3Client({ region: process.env.BACKUP_S3_REGION });
const BUCKET = process.env.BACKUP_S3_BUCKET;
const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/e_commerce_01-backups';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;

async function run() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `e_commerce_01-${date}.archive.gz`;
  const localPath = path.join(BACKUP_DIR, filename);
  const s3Key = `daily/${filename}`;

  await fs.mkdir(BACKUP_DIR, { recursive: true });

  // ─── 1. mongodump ───────────────────────────────────
  console.log(`[backup] Ejecutando mongodump → ${filename}`);
  await execAsync(
    `mongodump --uri="${process.env.MONGODB_URI}" --archive="${localPath}" --gzip --oplog`
  );

  const stats = await fs.stat(localPath);
  console.log(`[backup] Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  // ─── 2. Subir a S3 ──────────────────────────────────
  if (BUCKET) {
    console.log(`[backup] Subiendo a s3://${BUCKET}/${s3Key}`);
    const fileBuffer = await fs.readFile(localPath);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ServerSideEncryption: 'AES256',
    }));
    console.log('[backup] Subida completada');
  } else {
    console.warn('[backup] BACKUP_S3_BUCKET no configurado — backup solo local');
  }

  // ─── 3. Limpieza local ───────────────────────────────
  await fs.unlink(localPath);

  // ─── 4. (Opcional) Borrar backups > RETENTION_DAYS ──
  // Requiere ListObjectsV2; simplificado aquí.
  console.log(`[backup] ✅ Completado: ${date}`);
}

run().catch((err) => {
  console.error('[backup] ❌ Error:', err);
  process.exit(1);
});
# Paso 6.3.2: Programar el backup

Opción A — node-cron dentro del server (una sola instancia):

Añade al final de server.js, después de arrancar:

javascript
// server/src/server.js
import cron from 'node-cron';
import { exec } from 'node:child_process';

// Backup diario a las 02:00 UTC
cron.schedule('0 2 * * *', () => {
  console.log('[cron] Ejecutando backup diario');
  exec('node src/scripts/backup.js', (err, stdout, stderr) => {
    if (err) {
      console.error('[cron] Backup falló:', err.message);
      // Aquí puedes enviar alerta a Telegram
    } else {
      console.log('[cron] Backup OK:', stdout);
    }
  });
}, { timezone: 'UTC' });
Opción B — GitHub Action cron (recomendado si usas Render/Vercel):

yaml
# .github/workflows/backup.yml
name: Daily MongoDB Backup
on:
  schedule:
    - cron: '0 2 * * *' # 02:00 UTC cada día
  workflow_dispatch: # permite ejecución manual

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Install mongodb-tools
        run: sudo apt-get update && sudo apt-get install -y mongodb-database-tools
      - name: Run backup
        working-directory: server
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
          BACKUP_S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}
          BACKUP_S3_REGION: ${{ secrets.BACKUP_S3_REGION }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: npm ci && node src/scripts/backup.js
# Paso 6.3.3: Script de restore (y probarlo)

Crea server/src/scripts/restore.js:

javascript
// server/src/scripts/restore.js
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import 'dotenv/config';

const execAsync = promisify(exec);

const archive = process.argv[2];
if (!archive) {
  console.error('Uso: node src/scripts/restore.js <ruta-al-archive.gz>');
  process.exit(1);
}

const targetUri = process.env.MONGODB_URI_RESTORE || process.env.MONGODB_URI;

async function run() {
  console.log(`[restore] Restaurando ${archive} → ${targetUri}`);
  await execAsync(
    `mongorestore --uri="${targetUri}" --archive="${archive}" --gzip --drop`
  );
  console.log('[restore] ✅ Completado');
}

run().catch((err) => {
  console.error('[restore] ❌ Error:', err);
  process.exit(1);
});
Pruébalo al menos una vez al trimestre:

bash
# 1. Descarga un backup de S3
aws s3 cp s3://e_commerce_01-backups/daily/e_commerce_01-2026-10-21.archive.gz /tmp/

# 2. Restaura en una BD de prueba (NO en producción)
MONGODB_URI_RESTORE="mongodb://127.0.0.1:27017/e_commerce_01_restore_test" \
  node src/scripts/restore.js /tmp/e_commerce_01-2026-10-21.archive.gz

# 3. Verifica que los datos están ahí
mongosh "mongodb://127.0.0.1:27017/e_commerce_01_restore_test" --eval "db.orders.countDocuments()"
Nota sobre Atlas M0: el plan gratuito no incluye backups automáticos. Con M0, el script de mongodump + S3 es obligatorio. Con M10+ puedes usar los backups nativos de Atlas, pero igual conviene un backup externo (si Atlas cae, tus datos están en otro proveedor).

✅ Checklist backups:

□ node src/scripts/backup.js genera un .archive.gz válido.
□ El archivo se sube a S3 y aparece en el bucket.
□ El script de restore funciona contra una BD de prueba.
□ El cron corre automáticamente (verificar log al día siguiente).
□ La retención borra backups > 30 días (o está documentado cómo hacerlo).
📡 6.4 Uptime Monitoring Externo

Herramientas recomendadas: Better Stack (free: 10 monitores, checks cada 3 min) o UptimeRobot (free: 50 monitores, checks cada 5 min).

# Paso 6.4.1: Configurar los monitores

Monitor	URL	Frecuencia	Alerta
Backend health	https://api.tudominio.com/health	60s	Telegram + email
Backend ready	https://api.tudominio.com/ready	5 min	Telegram
Frontend	https://tudominio.com	60s	Telegram
# Paso 6.4.2: Conectar alertas a Telegram

Better Stack y UptimeRobot permiten configurar webhooks de alerta. La forma más simple es usar un servicio puente o configurar la integración nativa de Telegram si está disponible.

Opción directa con UptimeRobot (requiere plan Solo+): integración nativa de Telegram.

Opción gratuita con webhook + Bot de Telegram: configura el webhook de UptimeRobot para que apunte a tu backend:

javascript
// server/src/routes/alert.routes.js
import { Router } from 'express';
import { sendAlert } from '../services/alert.service.js';

const router = Router();

// Endpoint público protegido con un token simple
router.post('/uptime', async (req, res) => {
  const { token, monitor, status } = req.body;

  if (token !== process.env.UPTIME_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (status === 'down') {
    await sendAlert(`uptime:${monitor}`, `🔴 *${monitor} está DOWN*`);
  } else if (status === 'up') {
    await sendAlert(`uptime:${monitor}:recovery`, `🟢 *${monitor} recuperado*`);
  }

  res.json({ ok: true });
});

export default router;
Monta en app.js:

javascript
app.use('/api/alerts', alertRoutes);
✅ Checklist uptime:

□ Al parar el server, UptimeRobot/Better Stack detecta caída en < 5 min.
□ La alerta llega a Telegram.
□ Al reiniciar, llega notificación de recuperación.
□ Hay una página de status pública (opcional pero recomendada).
🧹 6.5 Cron de Órdenes Huérfanas

El bug: si Stripe nunca envía checkout.session.expired, la orden queda pending para siempre y el stock reservado eternamente.

# Paso 6.5.1: Función de expiración en order.service.js

javascript
// server/src/services/order.service.js — añade al final

/**
 * Expira órdenes pending con más de `hoursOld` horas.
 * Restaura stock en una transacción atómica.
 * @returns {Promise<{ expired: number }>}
 */
export async function expireStaleOrders(hoursOld = 24) {
  const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000);

  const staleOrders = await Order.find({
    status: 'pending',
    createdAt: { $lt: cutoff },
  });

  let expired = 0;

  for (const order of staleOrders) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Restaurar stock de cada item
      for (const item of order.items) {
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } },
          { session }
        );
      }

      order.status = 'cancelled';
      await order.save({ session });

      await session.commitTransaction();
      expired++;
      logger.info({ orderId: order._id }, 'Orden huérfana expirada, stock restaurado');
    } catch (err) {
      await session.abortTransaction();
      logger.error({ err, orderId: order._id }, 'Error expirando orden');
    } finally {
      session.endSession();
    }
  }

  return { expired };
}
# Paso 6.5.2: Programar el cron

En server.js, añade:

javascript
// server/src/server.js
import cron from 'node-cron';
import { expireStaleOrders } from './services/order.service.js';
import { sendAlert } from './services/alert.service.js';

// Cada hora: expira órdenes pending > 24h
cron.schedule('0 * * * *', async () => {
  logger.info('[cron] Ejecutando limpieza de órdenes huérfanas');
  try {
    const { expired } = await expireStaleOrders(24);
    logger.info({ expired }, '[cron] Órdenes expiradas');
    if (expired > 10) {
      // Posible problema con Stripe: demasiadas órdenes huérfanas
      await sendAlert('cron:orphans', `⚠️ ${expired} órdenes huérfanas expiradas en 1h. Revisar Stripe.`);
    }
  } catch (err) {
    logger.error({ err }, '[cron] Fallo en limpieza');
    await sendAlert('cron:orphans:error', `🔴 Cron de órdenes huérfanas falló: ${err.message}`);
  }
}, { timezone: 'UTC' });
⚠️ Múltiples réplicas: node-cron dentro del server ejecuta el job en cada réplica. Si escalas horizontalmente, migra a BullMQ repeatable jobs (que usan locks distribuidos en Redis) o usa una GitHub Action cron que llame a un endpoint protegido.
✅ Checklist cron huérfanas:

□ Crear orden pending con createdAt de hace 25h (manipulando Mongo).
□ Ejecutar el cron manualmente → orden pasa a cancelled, stock restaurado.
□ El cron corre cada hora (verificar logs).
□ Si falla, llega alerta a Telegram.
📧 6.6 Cola de Emails con BullMQ + Redis

Problema: hoy un email fallido bloquea el request del usuario. Con BullMQ, el email se encola y se procesa en segundo plano con reintentos exponenciales.

# Paso 6.6.1: Conexión a Redis (server/src/config/redis.js)

javascript
// server/src/config/redis.js
import Redis from 'ioredis';
import logger from './logger.js';

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(url, {
  maxRetriesPerRequest: null, // requerido por BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('connect', () => logger.info('✅ Redis conectado'));
redis.on('error', (err) => logger.error({ err }, '❌ Redis error'));
# Paso 6.6.2: Cola de emails (server/src/queues/email.queue.js)

javascript
// server/src/queues/email.queue.js
import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { transporter } from '../config/email.js';
import logger from '../config/logger.js';

export const emailQueue = new Queue('email', { connection: redis });

/**
 * Encola un email. No espera al envío.
 */
export async function enqueueEmail({ to, subject, html }) {
  return emailQueue.add(
    'send',
    { to, subject, html },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 }, // 3s, 6s, 12s
      removeOnComplete: { age: 86400, count: 1000 }, // limpieza automática
      removeOnFail: { age: 7 * 86400 },
    }
  );
}

/**
 * Worker: procesa emails en segundo plano.
 * Se registra en server.js al arrancar.
 */
export function startEmailWorker() {
  const worker = new Worker(
    'email',
    async (job) => {
      const { to, subject, html } = job.data;
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
      });
      logger.info({ messageId: info.messageId, to, jobId: job.id }, 'Email enviado');
      return info.messageId;
    },
    {
      connection: redis,
      concurrency: 5, // 5 emails en paralelo
    }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Email falló tras reintentos');
  });

  return worker;
}
# Paso 6.6.3: Refactorizar email.service.js para usar la cola

Reemplaza las llamadas directas a transporter.sendMail por enqueueEmail:

javascript
// server/src/services/email.service.js
import { enqueueEmail } from '../queues/email.queue.js';

export async function sendWelcome(user) {
  const html = `...`;
  return enqueueEmail({ to: user.email, subject: 'Bienvenido a e_commerce_01', html });
}

export async function sendPasswordReset(user, resetUrl) {
  const html = `...`;
  return enqueueEmail({ to: user.email, subject: 'Recupera tu contraseña', html });
}

export async function sendOrderConfirmation(order) {
  const html = `...`;
  return enqueueEmail({ to: order.user.email, subject: 'Tu pedido en e_commerce_01', html });
}
Ahora sendWelcome devuelve inmediatamente (solo encola), y el envío real ocurre en el worker. El registro de usuario responde en < 200ms aunque SMTP esté lento.

# Paso 6.6.4: Arrancar el worker en server.js

javascript
// server/src/server.js
import { startEmailWorker } from './queues/email.queue.js';

// ...después de app.listen...
const emailWorker = startEmailWorker();
logger.info('📧 Email worker iniciado');

// En el shutdown, cerramos el worker
const shutdown = (signal) => {
  // ...
  emailWorker.close();
  // ...
};
# Paso 6.6.5: Dashboard de colas (opcional pero muy útil)

Instala @bull-board/express:

bash
npm install @bull-board/express @bull-board/api
javascript
// server/src/app.js
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from './queues/email.queue.js';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

// Proteger con admin (solo en producción)
app.use('/admin/queues', protect, admin, serverAdapter.getRouter());
✅ Checklist cola emails:

□ Registrar usuario → responde en < 200ms aunque SMTP esté caído.
□ Si SMTP falla, el email se reintenta 3 veces (3s, 6s, 12s).
□ Tras 3 fallos, el job queda en "failed" (visible en Bull Board).
□ El worker se cierra limpiamente en SIGTERM.
✅ 6.7 Checklist Global de la Fase 6

Sentry

□ Error backend con req.id y ruta → visible en Sentry.
□ Error frontend con componente y línea exacta → visible en Sentry.
□ authorization/cookie → [REDACTED].
□ 401/404 no generan alertas.
□ Source maps funcionan en producción.
Alertas

□ Error 5xx → Telegram en < 30s.
□ Cooldown de 1h funciona (no spam).
□ /ready caído → alerta tras 3 checks.
□ Cron fallido → alerta.
Backups

□ mongodump genera .archive.gz válido.
□ Backup subido a S3/R2.
□ Restore probado en BD de prueba.
□ Cron diario corriendo.
Uptime

□ Better Stack / UptimeRobot monitorea /health y /ready.
□ Alerta a Telegram al caer.
□ Recuperación notificada.
Cron huérfanas

□ Orden pending > 24h → cancelled + stock restaurado.
□ Corre cada hora.
□ Alerta si expira un número anómalo (>10).
Cola emails

□ Registro no bloquea si SMTP cae.
□ 3 reintentos con backoff exponencial.
□ Bull Board visible en /admin/queues (admin).
Infraestructura

□ Redis añadido a docker-compose.yml.
□ docker compose up --build levanta Redis + Mongo + server + client.
□ El worker de emails arranca y se cierra limpiamente.
Commit

bash
git add .
git commit -m "feat(ops): phase 6 — observability, alerts, backups, cron and email queue

- Sentry (backend + frontend) with source maps and PII scrubbing
- Telegram alerts for 5xx errors, /ready failures and cron errors
- Automated mongodump backups to S3 with restore script
- Uptime monitoring via Better Stack / UptimeRobot webhook
- Hourly cron to expire stale pending orders and restore stock
- BullMQ + Redis email queue with exponential backoff retries
- Bull Board admin panel for queue visibility"
📊 Resumen Visual de la Fase 6

text
┌────────────────────────────────────────────────────────────────┐
│                     OPERACIÓN CONFIABLE                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │  Sentry     │─────▶│  Telegram    │      │  Better Stack│  │
│  │  (errores)  │      │  (alertas)   │◀─────│  (uptime)    │  │
│  └──────┬──────┘      └──────────────┘      └──────────────┘  │
│         │                                                       │
│         │ captura                                               │
│         ▼                                                       │
│  ┌─────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │  Express    │      │  node-cron   │      │  BullMQ      │  │
│  │  API        │─────▶│  huérfanas   │      │  email queue │  │
│  └──────┬──────┘      └──────┬───────┘      └──────┬───────┘  │
│         │                    │                     │          │
│         │                    ▼                     ▼          │
│         │             ┌──────────────┐      ┌──────────────┐  │
│         │             │  MongoDB     │◀─────│  Redis       │  │
│         │             │  (stock)     │      │  (jobs)      │  │
│         │             └──────┬───────┘      └──────────────┘  │
│         │                    │                                 │
│         ▼                    ▼                                 │
│  ┌──────────────────────────────────────┐                     │
│  │  mongodump diario → S3 (backup)      │                     │
│  └──────────────────────────────────────┘                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
