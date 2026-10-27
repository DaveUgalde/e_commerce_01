___________________________________________________________
🏗️ FASE 0 — Preparar un taller reproducible

📖 1. La Historia (El Porqué)

Antes de construir funcionalidades, se prepara un entorno donde todos puedan ejecutar la misma aplicación. La fase no busca terminar una tienda; busca que frontend, backend, base de datos, Redis, tipos y CI puedan comunicarse de forma reproducible.

El desarrollador debe entender el mapa mental: el navegador y el backend son procesos distintos. MongoDB conserva los datos y Redis apoya tareas rápidas. La tienda no es segura solo porque las pantallas se vean bien; el servidor debe validar todo.

Puntos críticos a entender en esta fase:

Docker (Mongo Replica Set): MongoDB debe ejecutarse como un Replica Set (rs0) desde el día 1. ¿Por qué? Porque en la Fase 2 usaremos transacciones, y MongoDB standalone no las soporta.
Vite: Ofrece un servidor de desarrollo. El proxy /api de vite.config.ts reenvía solicitudes al backend, pero el proxy no es la API y no sustituye la seguridad del backend.
Arranque de Express: app.ts construye la aplicación (middleware, rutas, errores). server.ts conecta a la base de datos y levanta el puerto.
TypeScript/ESM: Usamos módulos modernos (type: module). Los imports en TS deben llevar .js para que Node lo entienda en producción. La compilación real (npm run build) es la única prueba de fuego.
Tipos Neutrales: La carpeta shared/types/ contiene contratos compartidos sin acoplarse a Mongoose o React.

📋 2. El Checklist (El Qué)

□ Verificar Node 20, npm, Git y Docker.
□ Crear la estructura del monorepo (client/, server/, shared/, scripts/).
□ Crear los archivos de infraestructura Docker (dev, staging, prod).
□ Inicializar backend con TypeScript (NodeNext), ESM y configurar tsconfig.json para resolver @shared.
□ Instalar dependencias base del backend.
□ Crear los 4 tipos compartidos neutrales (user, product, cart, order).
□ Configurar el entorno del backend (.env.example, logger, database, redis).
□ Escribir la aplicación Express (app.ts) y el arranque (server.ts).
□ Inicializar frontend con Vite, configurar proxy y Axios.
□ Configurar CI base.
□ Crear README.md.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 0.1: Estructura y Variables de Entorno

Ejecuta los siguientes comandos para crear la estructura base y el control de versiones:

___________________________________________________________
<!-- Crear la carpeta raiz del proyecto -->
mkdir e_commerce_01 && cd e_commerce_01
<!-- inicializar git -->
git init
<!-- crear las carpetas del proyecto, para la arquitectura base -->
mkdir -p server shared/types scripts docs/adr .github/workflows
___________________________________________________________
.gitignore (Evita subir dependencias y secretos)
___________________________________________________________
node_modules/
dist/
.env
.env.*
!.env.example
logs/
*.log
coverage/
uploads/
*.map
.DS_Store
.vscode/
.idea/
___________________________________________________________
.nvmrc (Fija la versión de Node)
20
___________________________________________________________

Paso 0.2: Infraestructura Docker y Scripts

docker-compose.dev.yml (Mongo con Replica Set + Redis)
___________________________________________________________
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports: ["27017:27017"]
    volumes: ["mongo-data:/data/db"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
volumes:
  mongo-data:
___________________________________________________________
<!-- Crear el script que corre docker -->
scripts/init-replica.sh (Inicializa el Replica Set de Mongo)
___________________________________________________________
#!/bin/bash
docker exec -it e_commerce_01-mongo-1 mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"
___________________________________________________________
(Nota: Según el checklist, también debes crear docker-compose.staging.yml y docker-compose.prod.yml como plantillas de configuración por variables de entorno, pero no se despliegan hasta fases posteriores).
___________________________________________________________
docker-compose.staging.yml
___________________________________________________________
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    # En staging, exponemos en localhost solo para que el CI pueda probar
    ports: ["127.0.0.1:27017:27017"]
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    volumes: ["mongo-staging-data:/data/db"]
  redis:
    image: redis:7-alpine
    ports: ["127.0.0.1:6379:6379"]
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
volumes:
  mongo-staging-data:
______________________________________________________________________  
docker-compose.prod.yml
______________________________________________________________________  
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all", "--auth"] # Requiere autenticación
    # NO TIENE "ports": Solo accesible dentro de la red interna de Docker
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    volumes: ["mongo-prod-data:/data/db"]
  redis:
    image: redis:7-alpine
    # NO TIENE "ports": Solo red interna
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
volumes:
  mongo-prod-data:

____________________________________________________________
Paso 0.3: Backend - Configuración Inicial y Dependencias

<!-- Crear package.json para Bacnkend -->
<!-- ESM son especificaciones modernas de implementacion -->
<!-- TODO: Revisar como funciona, y la diferencia -->
server/package.json (Configurado para ESM y scripts de producción)
___________________________________________________________
{
  "name": "e_commerce_01-server",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/src/server.js",
    "typecheck": "tsc --noEmit",
    "test": "node --test --test-concurrency=1 --import tsx",
    "create-admin": "tsx scripts/createAdmin.ts"
  }
}
___________________________________________________________
server/tsconfig.json (Corregido: rootDir ampliado para leer @shared, sin baseUrl deprecado)
___________________________________________________________
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "..", 
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": { "@shared/*": ["./../shared/types/*"] }
  },
  "include": ["src/**/*.ts", "../shared/types/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
___________________________________________________________
Instalación de dependencias Backend:
___________________________________________________________
cd server
npm install express mongoose dotenv cors helmet bcryptjs jsonwebtoken express-rate-limit rate-limit-redis ioredis cookie-parser express-validator pino
npm install -D typescript @types/node @types/express @types/jsonwebtoken @types/bcryptjs @types/cors @types/cookie-parser @types/supertest @types/ioredis tsx supertest mongodb-memory-server
___________________________________________________________
Paso 0.4: Tipos Compartidos (Neutrales)

shared/types/user.ts
___________________________________________________________
export type Role = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}
___________________________________________________________
shared/types/product.ts
___________________________________________________________
export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;      // unidades menores (centavos)
  currency: string;   // ISO 4217
  stock: number;
  imageUrl: string;
  category: string;
  isActive: boolean;
}
___________________________________________________________
shared/types/cart.ts
___________________________________________________________
import type { Product } from './product.js';

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  id: string;
  userId: string;
  items: CartItem[];
  total: number;
}
___________________________________________________________
shared/types/order.ts
___________________________________________________________
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface OrderItem {
  productId: string;
  name: string;
  priceAtPurchase: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
}
___________________________________________________________
Paso 0.5: Configuración del Backend

.env.example (Crea una copia llamada .env y genera secretos con crypto.randomBytes)
___________________________________________________________
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/e_commerce_01?replicaSet=rs0
MONGODB_URI_TEST=mongodb://localhost:27017/e_commerce_01_test
JWT_SECRET=change-me-min-32-chars-long-xxxxxxxxxxxxxxxx
COOKIE_SECRET=change-me-32-chars-cookie-secret-xxxxx
CLIENT_ORIGIN=http://localhost:5173
REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_PREFIX=rl:
LOG_LEVEL=info
___________________________________________________________
server/src/config/logger.ts (Corregido el typo LOG_LEVEL)
___________________________________________________________
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password'],
});
___________________________________________________________
server/src/config/redis.ts (Usando ioredis como cliente oficial)
___________________________________________________________
import { Redis } from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});
___________________________________________________________
server/src/config/database.ts
___________________________________________________________
import { connect, connection, disconnect } from 'mongoose';
import { logger } from './logger.js';

export async function connectDatabase(uri: string): Promise<void> {
  connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  await connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info('MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> { 
  await disconnect(); 
}
___________________________________________________________
server/src/app.ts (Configurado con Rate Limit en Redis usando ioredis)
___________________________________________________________
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './config/redis.js';
import { logger } from './config/logger.js';
import { AppError } from './utils/AppError.js'; // Se creará en Fase 1

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

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Ruta no encontrada' }));

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    logger.error({ err }, 'Unhandled error');
    res.status(status).json({ code: 'INTERNAL', message: 'Error interno' });
  });
  
  return app;
}
___________________________________________________________
mkdir -p src/utils

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string,
    public isOperational = true
  ) {
    super(message);
    this.name = 'AppError';
  }
}

___________________________________________________________
server/src/server.ts
___________________________________________________________
import 'dotenv/config';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';

async function bootstrap(): Promise<void> {
  await connectDatabase(process.env.MONGODB_URI!);
  const app = await createApp();
  const server = app.listen(process.env.PORT ?? 3000, () => logger.info('Server on :3000'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(); 
    await disconnectDatabase(); 
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { logger.error({ err }, 'Bootstrap failed'); process.exit(1); });
___________________________________________________________
Paso 0.6: Frontend (Vite + React + TypeScript)

Ejecuta los siguientes comandos:
___________________________________________________________
npm create vite@latest client -- --template react-ts
cd client
<!-- TODO: explicar que hace este comando y axios -->
npm install react-router-dom axios
___________________________________________________________
Actualizar el vite.config.js
client/vite.config.ts (Configuración de alias y proxy)
___________________________________________________________
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/types') } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
___________________________________________________________
Crear archivo en Client:
client/src/services/api.ts (Instancia base de Axios)
___________________________________________________________
import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});
___________________________________________________________
.github/workflows/ci.yml (Verifica backend y frontend en cada push)
___________________________________________________________
name: CI
on: [push, pull_request]
jobs:
  test-server:
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand({ ping: 1 })'"
          --health-interval 10s --health-timeout 5s --health-retries 5
        ports: ["27017:27017"]
      redis:
        image: redis:7
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm', cache-dependency-path: server/package-lock.json }
      - name: Init replica set
        run: |
          mongosh --host localhost:27017 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
          sleep 3
      - run: cd server && npm ci
      - run: cd server && npm run typecheck
      - run: cd server && npm run build
      - run: cd server && npm test
        env:
          MONGODB_URI: mongodb://localhost:27017/e_commerce_01_test?replicaSet=rs0
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-at-least-32-chars-long-1234
          COOKIE_SECRET: test-cookie-secret
  build-client:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm', cache-dependency-path: client/package-lock.json }
      - run: cd client && npm ci
      - run: cd client && npm run typecheck
      - run: cd client && npm run build
___________________________________________________________
🚦 4. Gate 0 (Validación)

No avances a la Fase 1 hasta que se cumplan TODOS estos puntos:

□ Clon limpio: git clone, npm ci en server/client funcionan.
para probar esto, y como se acaba de crear, hay que utilizar npm ci para simular esa instalacion limpia, (npm ci borra node_modules y lo instala desde cero basandose en el package-lock.json)

<!-- En la raiz -->
cd server
npm ci
cd ../client
npm ci

Debe terminar sin errores y sin el mensaje de edgesOut.

<!--  -->
davidugaldesolis@Davids-MacBook-Pro server % npm ci

added 212 packages, and audited 213 packages in 5s

46 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
davidugaldesolis@Davids-MacBook-Pro server % cd ..
davidugaldesolis@Davids-MacBook-Pro e_commerce_01 % cd client 
davidugaldesolis@Davids-MacBook-Pro client % npm ci

added 60 packages, and audited 61 packages in 696ms

16 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
davidugaldesolis@Davids-MacBook-Pro client % 
<!--  -->
________________________________________________
□ Docker: docker compose -f docker-compose.dev.yml up -d --wait levanta Mongo y Redis.

<!-- En la raiz -->
docker compose -f docker-compose.dv.yml up -d --wait

* -f docker-compose.dev.yml: Le dice a Docker que use el archivo de desarrollo que creamos.
* up: Levanta los servicios.
* -d: (Detached) Los ejecuta en segundo plano para que la terminal no se quede bloqueada.
* --wait: Muy importante. Le dice a Docker que no termine el comando hasta que los contenedores estén completamente "Healthy" (saludables) y listos para recibir conexiones.

<!-- Resultado: -->
davidugaldesolis@Davids-MacBook-Pro e_commerce_01 % docker compose -f docker-compose.dev.yml up -d --wait
[+] up 25/25
 ✔ Image redis:7-alpine            Pulled                     3.0s
 ✔ Image mongo:7                   Pulled                     9.6s
 ✔ Network e_commerce_01_default   Created                    0.0s
 ✔ Volume e_commerce_01_mongo-data Created                    0.0s
 ✔ Container e_commerce_01-redis-1 Healthy                    0.8s
 ✔ Container e_commerce_01-mongo-1 Healthy      
________________________________________________
□ Replica Set: ./scripts/init-replica.sh devuelve ok: 1.

<!-- en la raiz -->
<!-- Dar permisos de ejecucion (solo la primera vez) -->
chmod +x scripts/init-replica.sh
<!-- Inicializar el Replica Set -->
./scripts/init-replica.sh

<!-- Resultado -->
davidugaldesolis@Davids-MacBook-Pro e_commerce_01 % ./scripts/init-replica.sh
{
  info2: 'no configuration specified. Using a default configuration for the set',
  me: '6c304fb3dee9:27017',
  ok: 1
}

<!-- Nota:
un grupo de servidores de MongoDB que mantienen exactamente la misma copia de los datos. Su propósito principal es la alta disponibilidad: si un servidor falla, otro toma el relevo automáticamente, y el sistema sigue funcionando sin intervención manual.

--replSet "rs0": Le dice a MongoDB que este proceso va a formar parte de un Replica Set llamado rs0. Es el nombre que identifica al clúster. Podrías llamarlo de otra forma, como mi-cluster.
--bind_ip_all: Le indica a MongoDB que acepte conexiones desde cualquier dirección IP. Es un atajo específico para Docker, porque dentro de un contenedor la IP no es predecible. En un servidor tradicional, se suele usar --bind_ip 127.0.0.1,IP_DEL_SERVIDOR para ser más restrictivo.
rs.initiate(): Es el comando que se ejecuta una sola vez (a través de mongosh) para dar el "visto bueno" inicial. Le dice al servidor: "Confirma que este nodo es parte del Replica Set y empieza a funcionar como tal". Sin este paso, el servidor queda en modo "espera".

En Produccion:
Para producción, la configuración es más robusta y no se hace con un solo contenedor de Docker:

Mínimo 3 Nodos: La recomendación oficial de MongoDB para producción es tener como mínimo 3 miembros en el Replica Set (1 primario y 2 secundarios). Esto garantiza que, si un nodo falla, los otros dos puedan ponerse de acuerdo (formar "quórum") para elegir un nuevo primario.
Sin --bind_ip_all: En servidores reales, se usa una IP específica (o un archivo de configuración mongod.conf) por seguridad.
Sin rs.initiate() manual: En plataformas gestionadas como MongoDB Atlas, el clúster ya viene con el Replica Set configurado y funcionando. Tú solo copias la cadena de conexión (mongodb+srv://...) que te proporcionan. En servidores propios, se automatiza con herramientas de Infraestructura como Código (IaC) o scripts de inicialización más complejos.
En resumen: Los tres parámetros que usaste son un "kit de inicio rápido" perfecto para tu entorno de desarrollo. Te permiten tener un Replica Set funcional con un solo comando. Para producción, el concepto es el mismo, pero la implementación requiere más nodos y una configuración de seguridad y automatización más estricta.
 -->
________________________________________________
□ Redis: redis-cli ping devuelve PONG.

<!-- Verificar que redis responde -->
docker exec -it e_commerce_01-redis-1 redis-cli ping

<!-- Resultado -->
PONG

________________________________________________
□ Typecheck + Build: npm run typecheck y npm run build pasan en el servidor (sin errores de logger, redis ni @shared) y en el cliente.

<!-- Verifica Backend -->
cd server
npm run typecheck
npm run build
<!-- Verifica Frontend -->
cd ../client
npm run build

<!-- Resultado -->
davidugaldesolis@Davids-MacBook-Pro client % npm run build

> client@0.0.0 build
> tsc -b && vite build

vite v8.3.5 building client environment for production...
✓ 20 modules transformed.
computing gzip size...
dist/index.html                   0.45 kB │ gzip:  0.29 kB
dist/assets/react-CHdo91hT.svg    4.12 kB │ gzip:  2.06 kB
dist/assets/vite-BF8QNONU.svg     8.70 kB │ gzip:  1.60 kB
dist/assets/hero-CLDdwZDr.png    13.05 kB
dist/assets/index-D64VDMd1.css    4.10 kB │ gzip:  1.47 kB
dist/assets/index-GpEN3EET.js   222.44 kB │ gzip: 69.28 kB

✓ built in 74ms
davidugaldesolis@Davids-MacBook-Pro client % 

<!-- Nota:
Dependiendo de la configuracion, al utilizar __dirname puede aparecer el siguiente error, hay que cambiarlo utilizando el import.meta.dirname:

Your Vite config uses features that are unsupported by configLoader: 'native'...
- __dirname (vite.config.ts:8:47). Use import.meta.dirname instead

 -->

<!-- Error de configuracion de Mongo al tener initiate() vacio, Mac no reconoce la redireccion de Mongo con Docker, Solucion especificar, ya el archivo de script esta actualizado, este seria el comando para actualizarlo de forma manual-->
 docker exec -it e_commerce_01-mongo-1 mongosh --eval "rs.reconfig({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]}, {force: true})"

________________________________________________
Entender bien como interaccionan los elementos a este punto, hay un error entre los mensajes del cliente y del servidor.


davidugaldesolis@Davids-MacBook-Pro e_commerce_01 % curl -i http://localhost:5173/api/health
HTTP/1.1 404 Not Found
vary: Origin
content-security-policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
origin-agent-cluster: ?1
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-dns-prefetch-control: off
x-download-options: noopen
x-frame-options: SAMEORIGIN
x-permitted-cross-domain-policies: none
x-xss-protection: 0
access-control-allow-origin: http://localhost:5173
access-control-allow-credentials: true
ratelimit-policy: 100;w=60
ratelimit-limit: 100
ratelimit-remaining: 99
ratelimit-reset: 60
content-type: application/json; charset=utf-8
content-length: 51
etag: W/"33-7M5Mp1bV3d7JUBT1yTV6lvybybQ"
date: Tue, 27 Oct 2026 22:49:27 GMT
connection: close

{"code":"NOT_FOUND","message":"Ruta no encontrada"}%       
davidugaldesolis@Davids-MacBook-Pro e_commerce_01 % 


El del servidor:

davidugaldesolis@Davids-MacBook-Pro server % curl -i http://localhost:3000/health
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0
Access-Control-Allow-Origin: http://localhost:5173
Vary: Origin
Access-Control-Allow-Credentials: true
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-VaSQ4oDUiZblZNAEkkN+sX+q3Sg"
Date: Tue, 27 Oct 2026 22:48:16 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok"}%

--- -- --- ---- ---- ---- ------ ----- ------ --
para resolver esto, hay que hacer que Express escuche en ambas rutas:

<!-- Antes -->
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

<!-- Ahora -->
// Acepta tanto /health (para infraestructura) como /api/health (para el proxy)

app.get(['/health', '/api/health'], (_req, res) => res.json({ status: 'ok' }));

________________________________________________
□ Servidor: npm run dev arranca en :3000.
□ Health: GET /health responde 200 {"status":"ok"}.
□ Frontend: Levanta en :5173 y el proxy redirige /api al backend.
□ Git: git status limpio; .env y node_modules ignorados.