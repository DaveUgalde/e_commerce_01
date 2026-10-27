
___________________________________________________________
🚀 FASE 9 — Escalar sin comprometer la consistencia

📖 1. La Historia (El Porqué)

La optimización llega después de tener flujos correctos y medibles. Cachear o añadir un motor de búsqueda antes de definir consistencia puede producir páginas rápidas que muestran información equivocada.

Puntos críticos a entender en esta fase:

Caché en Redis (con invalidación): Guardamos los resultados de /products en memoria (Redis) por 5 minutos. Cuando el administrador crea o edita un producto, debemos invalidar la caché inmediatamente; de lo contrario, los usuarios verían datos viejos. Nunca se cachean respuestas personalizadas (carrito, usuario, pedidos).
Meilisearch: MongoDB es lento para búsquedas de texto complejas. Meilisearch permite tolerancia a errores tipográficos ("iPone" → "iPhone"). Para no acoplar el código, usamos la interfaz SearchProvider definida en Fase 2.
CDN (Content Delivery Network): En lugar de servir imágenes desde el servidor Node, las subimos a S3/R2 y las servimos desde un CDN (ej. CloudFront o Cloudflare). Esto reduce la carga del servidor y acelera la entrega.
OpenAPI (Swagger): Es una documentación viva de la API. Se genera a partir de JSDoc en las rutas y permite a otros desarrolladores (o a ti mismo en el futuro) probar los endpoints sin adivinar los contratos.
Multi-moneda: Es crucial distinguir entre la moneda de presentación (lo que el usuario ve en su pantalla, ej. EUR) y la moneda de liquidación (lo que Stripe cobra realmente, ej. USD). Convertimos precios visualmente, pero la orden y el pago se guardan en USD.
📋 2. El Checklist (El Qué)

□ Backend (Dependencias): Instalar meilisearch, @aws-sdk/client-s3, swagger-jsdoc, swagger-ui-express.
□ Infraestructura: Añadir Meilisearch a docker-compose.dev.yml.
□ Backend (Caché): Crear cache.service.ts. Refactorizar product.service.ts (cache-aside). Invalidar caché en createProduct y updateProduct.
□ Backend (Búsqueda): Crear meilisearch.config.ts, meiliSearchProvider.ts, reindex.ts.
□ Backend (Storage): Crear storage.service.ts (drivers local/s3). Refactorizar image.service.ts. Crear migrate-images-to-cdn.ts.
□ Backend (Docs): Crear openapi.ts y docs.routes.ts.
□ Backend (Moneda): Crear currency.service.ts y currency.routes.ts.
□ Frontend (Moneda): Crear CurrencyContext.tsx y CurrencySelector.tsx. Envolver App.tsx y añadir al Layout.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 9.1: Infraestructura y Dependencias

Instalación:
___________________________________________________________
cd server
npm install meilisearch @aws-sdk/client-s3
npm install -D swagger-jsdoc swagger-ui-express @types/swagger-jsdoc @types/swagger-ui-express
___________________________________________________________
Actualizar docker-compose.dev.yml (Añadir Meilisearch)
___________________________________________________________
services:
  # ... mongo y redis ...
  meilisearch:
    image: getmeili/meilisearch:v1.6
    ports: ["7700:7700"]
    environment:
      MEILI_MASTER_KEY: masterKey
    volumes: ["meili-data:/meili_data"]
volumes:
  mongo-data:
  meili-data:

___________________________________________________________
Paso 9.2: Caché en Redis

server/src/services/cache.service.ts
___________________________________________________________
import { redis } from '../config/redis.js';

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function cacheSet(key: string, value: any, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheInvalidate(pattern: string): Promise<void> {
  let cursor = '0';
  do {
    // Usamos SCAN en lugar de KEYS para no bloquear Redis
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
}
___________________________________________________________
Refactorizar server/src/services/product.service.ts (Cache-aside)
___________________________________________________________
import crypto from 'node:crypto';
import { cacheGet, cacheSet, cacheInvalidate } from './cache.service.js';
import { ProductModel } from '../models/Product.js';
import { searchProvider } from './search.interface.js';

const TTL = Number(process.env.CACHE_TTL_PRODUCTS ?? 300); // 5 minutos

export async function listProducts(filters: any = {}) {
  const { q, page = 1, limit = 12 } = filters;

  // Búsqueda por texto (Meili o MongoRegex) - No se cachea aquí
  if (q) {
    const results = await searchProvider.searchProducts(q);
    return { data: results, total: results.length, page: 1, totalPages: 1 };
  }

  const key = `products:list:${crypto.createHash('md5').update(JSON.stringify(filters)).digest('hex')}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  // Si no está en caché, consultar DB
  const query: any = { isActive: true };
  // ... (lógica de filtros: category, minPrice, maxPrice, sort) ...

  const skip = (Number(page) - 1) * Number(limit);
  const total = await ProductModel.countDocuments(query);
  const data = await ProductModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();

  const result = { data, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) };
  
  await cacheSet(key, result, TTL);
  return result;
}

export async function createProduct(dto: any) {
  const p = await ProductModel.create(dto);
  await cacheInvalidate('products:list:*'); // Invalidar catálogo
  return p;
}

export async function updateProduct(id: string, dto: any) {
  const p = await ProductModel.findByIdAndUpdate(id, dto, { new: true });
  await cacheInvalidate('products:list:*');
  await cacheInvalidate(`products:detail:${id}`);
  return p;
}
___________________________________________________________
Paso 9.3: Meilisearch Provider

server/src/config/meilisearch.ts
___________________________________________________________
import { MeiliSearch } from 'meilisearch';

export const meili = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST!,
  apiKey: process.env.MEILISEARCH_KEY!,
});

export async function ensureIndexes() {
  try {
    await meili.createIndex('products', { primaryKey: 'id' });
    await meili.index('products').updateSettings({
      searchableAttributes: ['name', 'description', 'category'],
      filterableAttributes: ['category', 'isActive', 'price'],
      sortableAttributes: ['price', 'createdAt'],
    });
  } catch (e) {
    // Índice ya existe
  }
}
___________________________________________________________
server/src/services/meiliSearchProvider.ts
___________________________________________________________
import { meili } from '../config/meilisearch.js';
import type { SearchProvider } from './search.interface.js';

export class MeiliSearchProvider implements SearchProvider {
  async searchProducts(query: string) {
    const res = await meili.index('products').search(query, { filter: 'isActive = true' });
    return res.hits;
  }
}
___________________________________________________________
server/src/scripts/reindex.ts
___________________________________________________________
import 'dotenv/config';
import mongoose from 'mongoose';
import { ProductModel } from '../models/Product.js';
import { meili } from '../config/meilisearch.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const products = await ProductModel.find().lean();
  
  await meili.index('products').deleteAllDocuments();
  await meili.index('products').addDocuments(products.map((p: any) => ({ ...p, id: p._id.toString() })));
  
  console.log(`Reindexed ${products.length} products`);
  await mongoose.disconnect();
}
run();
___________________________________________________________
Actualizar server/src/server.ts
___________________________________________________________
import { ensureIndexes } from './config/meilisearch.js';

async function bootstrap() {
  // ...
  await ensureIndexes();
  if (process.env.REINDEX_ON_START === 'true') {
    const { default: reindex } = await import('./scripts/reindex.js'); // Ajuste simple
  }
  // ...
}
___________________________________________________________
Paso 9.4: Storage Service (CDN)

server/src/services/storage.service.ts
___________________________________________________________
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const driver = process.env.STORAGE_DRIVER ?? 'local';
const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function upload(buffer: Buffer, key: string): Promise<string> {
  if (driver === 'local') {
    const filepath = path.join(process.env.UPLOAD_DIR!, key);
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, buffer);
    return `/uploads/${key}`;
  }
  
  // s3 / r2
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!, Key: key, Body: buffer, ContentType: 'image/webp',
  }));
  return `${process.env.CDN_URL}/${key}`;
}
___________________________________________________________
Refactorizar server/src/services/image.service.ts
___________________________________________________________
import sharp from 'sharp';
import crypto from 'node:crypto';
import { upload } from './storage.service.js';

export async function processImage(buffer: Buffer) {
  const baseName = crypto.randomUUID();
  const folder = new Date().toISOString().slice(0, 7); // YYYY-MM
  const sizes = { thumb: 200, card: 600, full: 1200 };
  const result: any = {};

  for (const [key, width] of Object.entries(sizes)) {
    const processed = await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    result[key] = await upload(processed, `${folder}/${baseName}-${key}.webp`);
  }
  const original = await sharp(buffer).webp({ quality: 90 }).toBuffer();
  result.original = await upload(original, `${folder}/${baseName}-original.webp`);

  return result;
}
___________________________________________________________
server/src/scripts/migrate-images-to-cdn.ts (Idempotente)
___________________________________________________________
import 'dotenv/config';
import mongoose from 'mongoose';
import { ProductModel } from '../models/Product.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const cdn = process.env.CDN_URL!;
  
  // Solo busca las que NO apunten al CDN todavía
  const products = await ProductModel.find({ 'images.card': { $not: new RegExp(`^${cdn}`) } });
  
  let updated = 0;
  for (const p of products) {
    const rewrite = (u: string) => u.startsWith('/uploads/') ? `${cdn}${u}` : u;
    p.images = {
      thumb: rewrite(p.images.thumb), card: rewrite(p.images.card),
      full: rewrite(p.images.full), original: rewrite(p.images.original),
    };
    await p.save();
    updated++;
  }
  console.log(`Rewritten ${updated} products`);
  await mongoose.disconnect();
}
run();
___________________________________________________________
Paso 9.5: OpenAPI y Multi-moneda

server/src/docs/openapi.ts
___________________________________________________________
import swaggerJsdoc from 'swagger-jsdoc';

export const openapiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'e_commerce_01 API', version: '1.0.0' },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
  },
  apis: ['./src/routes/*.ts'],
});
___________________________________________________________
server/src/routes/docs.routes.ts
___________________________________________________________
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from '../docs/openapi.js';
import { protect, admin } from '../middlewares/auth.middleware.js';

export const docsRouter = Router();
docsRouter.get('/docs-json', (_req, res) => res.json(openapiSpec));

if (process.env.NODE_ENV !== 'production') {
  docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
} else {
  docsRouter.use('/docs', protect, admin, swaggerUi.serve, swaggerUi.setup(openapiSpec));
}
___________________________________________________________
server/src/services/currency.service.ts
___________________________________________________________
import { cacheGet, cacheSet } from './cache.service.js';

const FALLBACK = { USD: 1, EUR: 0.92, MXN: 17, ARS: 350, COP: 4000 };

export async function getExchangeRates() {
  const cached = await cacheGet<any>('rates');
  if (cached) return cached;
  try {
    const res = await fetch(`${process.env.EXCHANGE_RATE_API_URL}?base=USD`);
    const data: any = await res.json();
    await cacheSet('rates', data.rates, 3600);
    return data.rates;
  } catch {
    return FALLBACK;
  }
}
___________________________________________________________
server/src/routes/currency.routes.ts
___________________________________________________________
import { Router } from 'express';
import { getExchangeRates } from '../services/currency.service.js';
export const currencyRouter = Router();
currencyRouter.get('/rates', async (_req, res) => res.json(await getExchangeRates()));
___________________________________________________________
Frontend: client/src/context/CurrencyContext.tsx
___________________________________________________________
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../services/api';

const Ctx = createContext<any>(null);

export function CurrencyProvider({ children }: any) {
  const [currency, setCurrency] = useState(localStorage.getItem('currency') ?? 'USD');
  const [rates, setRates] = useState<any>({ USD: 1 });

  useEffect(() => {
    api.get('/currency/rates').then((r) => setRates(r.data));
  }, []);

  const convert = (amount: number) => Math.round(amount * (rates[currency] ?? 1) / (rates.USD ?? 1));
  const format = (amount: number) => new Intl.NumberFormat('es', { style: 'currency', currency }).format(convert(amount) / 100);

  const change = (c: string) => { setCurrency(c); localStorage.setItem('currency', c); };

  return <Ctx.Provider value={{ currency, rates, convert, format, change }}>{children}</Ctx.Provider>;
}

export const useCurrency = () => useContext(Ctx);
___________________________________________________________
Frontend: client/src/components/CurrencySelector.tsx
___________________________________________________________
import { useCurrency } from '../context/CurrencyContext';

export function CurrencySelector() {
  const { currency, change } = useCurrency();
  return (
    <select value={currency} onChange={(e) => change(e.target.value)} style={{ padding: '0.2rem' }}>
      <option value="USD">USD</option>
      <option value="EUR">EUR</option>
      <option value="MXN">MXN</option>
      <option value="COP">COP</option>
    </select>
  );
}
___________________________________________________________
🚦 4. Gate 9 (Validación)

No avances a la Fase 10 hasta que se cumplan TODOS estos puntos:

□ Caché rápida: Medir el tiempo de GET /api/products con curl -w "%{time_total}". La primera llamada tarda ~50ms, la segunda (en caché) tarda <5ms.
□ Invalidación de caché: Crear un producto nuevo desde el Admin. Hacer una petición a /api/products y verificar que el producto nuevo aparece inmediatamente (la caché se limpió).
□ Fallback de Redis: Detener Redis (docker stop redis). La app debe seguir funcionando consultando directamente a MongoDB (sin caché, pero sin caerse).
□ Búsqueda tolerante: En la barra de búsqueda, escribir "iPone". Meilisearch debe devolver el producto "iPhone" (siempre que Meilisearch esté corriendo y se haya ejecutado npm run reindex).
□ CDN de imágenes: En el admin, subir una imagen. Verificar que la URL guardada en la base de datos empieza por el CDN_URL (si configuraste S3) o /uploads/ (si usas local).
□ Swagger: Navegar a /api/docs. Ver la interfaz de Swagger UI, poder ver los endpoints documentados y probar un GET /products desde ahí.
□ Multi-moneda: Cambiar el selector de moneda a EUR en el Header. Los precios del catálogo deben cambiar instantáneamente (ej. de $999 a €919). Si recargas la página, la moneda seleccionada debe persistir.
