Fase 9 Granular: Escalabilidad Técnica

Con ~100 usuarios/día nada de esto hace falta. Con 10,000/día es obligatorio. Esta fase es la diferencia entre "funciona en mi portátil" y "aguanta el Black Friday sin arrodillarse".

#	Componente	Cuándo es crítico	Resultado
1	Redis cache de catálogo	> 500 usuarios/día	95% menos queries a Mongo
2	Meilisearch para búsqueda	> 1,000 productos	Búsqueda con typos en < 50ms
3	CDN de imágenes (S3/R2 + CloudFront)	Siempre (offload del backend)	Imágenes servidas globalmente
4	Migraciones versionadas (migrate-mongo)	> 1 dev o cambios frecuentes	Zero-downtime schema changes
5	OpenAPI/Swagger	> 1 dev en el equipo	Documentación auto-generada
6	Multi-moneda real	Si vendes a >1 país	Cobrar en EUR, MXN, etc.
⚠️ Regla de oro: no implementes todo si no lo necesitas. Cada pieza añade complejidad operacional. Empieza por 9.1 (cache) y 9.4 (migraciones), que son los de mayor ROI.

📦 9.0 Dependencias y Variables

9.0.1 Instalación

Backend:

bash
cd server
npm install meilisearch @aws-sdk/client-cloudfront
npm install --save-dev migrate-mongo swagger-jsdoc swagger-ui-express
Redis ya está instalado (Fase 6, BullMQ).
9.0.2 Ampliar server/.env.example

env
# ─── Cache ───────────────────────────────────────────────
CACHE_TTL_PRODUCTS=60          # segundos
CACHE_TTL_PRODUCT_DETAIL=300
CACHE_TTL_CATEGORIES=600

# ─── Meilisearch ─────────────────────────────────────────
MEILISEARCH_HOST=http://127.0.0.1:7700
MEILISEARCH_API_KEY=masterKey_change_in_production

# ─── CDN / Almacenamiento de imágenes ────────────────────
STORAGE_DRIVER=local           # local | s3 | r2
CDN_URL=                       # ej. https://cdn.e_commerce_01.com
AWS_S3_BUCKET=e_commerce_01-images
AWS_S3_REGION=us-east-1
AWS_CLOUDFRONT_DISTRIBUTION_ID=
# Para R2 (Cloudflare):
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=e_commerce_01-images
R2_PUBLIC_URL=https://pub-xxxx.r2.dev

# ─── Multi-currency ──────────────────────────────────────
EXCHANGE_RATE_API_KEY=
BASE_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,MXN,ARS,COP
EXCHANGE_RATE_CACHE_TTL=3600   # segundos
9.0.3 Añadir Meilisearch al docker-compose.yml

yaml
services:
  # ...mongo, redis, server, client

  meilisearch:
    image: getmeili/meilisearch:v1.9
    restart: unless-stopped
    ports:
      - "7700:7700"
    environment:
      MEILI_MASTER_KEY: ${MEILISEARCH_API_KEY:-masterKey_change_me}
      MEILI_ENV: production
      MEILI_NO_ANALYTICS: "true"
    volumes:
      - meili-data:/meili_data

volumes:
  mongo-data:
  uploads-data:
  redis-data:
  meili-data: # nuevo
Y en el servicio server:

yaml
  server:
    environment:
      MEILISEARCH_HOST: http://meilisearch:7700
      MEILISEARCH_API_KEY: ${MEILISEARCH_API_KEY:-masterKey_change_me}
    depends_on:
      # ...existentes
      meilisearch:
        condition: service_started
⚡ 9.1 Redis Cache de Catálogo

Concepto

Hoy cada GET /products hace 2 queries a Mongo (find + countDocuments). Con cache-aside, la primera petición popula el cache y las siguientes 60 segundos responden en ~5ms (vs ~80ms). Con 100 req/s, eso son 95% menos queries.

Patrón cache-aside:

text
Request → ¿Está en Redis?
  ├─ Sí → devolver cache (5ms) ✅
  └─ No → query Mongo (80ms) → guardar en Redis (TTL 60s) → devolver
Invalidación: al crear/editar/borrar producto, borrar todas las claves products:*.

Paso 9.1.1: Servicio de cache (server/src/services/cache.service.js)

javascript
// server/src/services/cache.service.js
import { redis } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * Obtiene un valor del cache. Devuelve null si no existe.
 */
export async function cacheGet(key) {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err, key }, 'Cache get falló, cayendo a DB');
    return null;
  }
}

/**
 * Guarda un valor en cache con TTL.
 */
export async function cacheSet(key, value, ttlSeconds = 60) {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'Cache set falló (no crítico)');
  }
}

/**
 * Borra claves por patrón (ej. "products:*").
 * Usa SCAN (no KEYS) para no bloquear Redis en producción.
 */
export async function cacheInvalidate(pattern) {
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info({ pattern, count: keys.length }, 'Cache invalidado');
      }
    } while (cursor !== '0');
  } catch (err) {
    logger.error({ err, pattern }, 'Cache invalidate falló');
  }
}
Paso 9.1.2: Refactorizar product.service.js

javascript
// server/src/services/product.service.js
import { cacheGet, cacheSet, cacheInvalidate } from './cache.service.js';
import crypto from 'node:crypto';

const TTL_LIST = Number(process.env.CACHE_TTL_PRODUCTS) || 60;
const TTL_DETAIL = Number(process.env.CACHE_TTL_PRODUCT_DETAIL) || 300;
const TTL_CATEGORIES = Number(process.env.CACHE_TTL_CATEGORIES) || 600;

/**
 * Cache key determinística: hash de los filtros normalizados.
 * Garantiza que "page=1&limit=12" y "limit=12&page=1" generen la misma key.
 */
function filtersKey(query) {
  const normalized = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return crypto.createHash('md5').update(normalized).digest('hex');
}

export async function listProducts(query, { isAdmin = false } = {}) {
  const cacheKey = `products:list:${isAdmin ? 'admin:' : ''}${filtersKey(query)}`;

  // 1. Intentar cache
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  // 2. Query real
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  const includeInactive = query.includeInactive === 'true';
  if (!(isAdmin && includeInactive)) filter.isActive = true;
  if (query.category) filter.category = query.category;

  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
  }

  if (query.q) {
    filter.$or = [
      { name: { $regex: query.q, $options: 'i' } },
      { description: { $regex: query.q, $options: 'i' } },
    ];
  }

  const SORT_MAP = {
    newest: { createdAt: -1 }, oldest: { createdAt: 1 },
    price_asc: { price: 1 }, price_desc: { price: -1 },
    name_asc: { name: 1 }, name_desc: { name: -1 },
  };
  const sort = SORT_MAP[query.sort] || SORT_MAP.newest;

  const [products, total] = await Promise.all([
    Product.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);

  const result = { products, meta: buildPaginationMeta({ page, limit, total }) };

  // 3. Guardar en cache (solo si es seguro: nunca cachear admins)
  if (!isAdmin) await cacheSet(cacheKey, result, TTL_LIST);

  return result;
}

export async function getProductById(id) {
  const cacheKey = `products:detail:${id}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const product = await Product.findById(id).lean();
  if (!product || !product.isActive) throw new AppError('Producto no encontrado', 404);

  await cacheSet(cacheKey, product, TTL_DETAIL);
  return product;
}

export async function createProduct(data) {
  const slug = await Product.generateSlug(data.name);
  const product = await Product.create({ ...data, slug });

  // Invalidar TODO el catálogo (los listados pueden incluir el nuevo)
  await cacheInvalidate('products:*');

  return product;
}

export async function updateProduct(id, data) {
  if (data.name) data.slug = await Product.generateSlug(data.name);

  const product = await Product.findByIdAndUpdate(id, data, {
    new: true, runValidators: true,
  });
  if (!product) throw new AppError('Producto no encontrado', 404);

  await cacheInvalidate('products:*');

  return product;
}

export async function deleteProduct(id) {
  const product = await Product.findByIdAndUpdate(
    id, { isActive: false }, { new: true }
  );
  if (!product) throw new AppError('Producto no encontrado', 404);

  await cacheInvalidate('products:*');

  return product;
}

export async function listCategories() {
  const cacheKey = 'products:categories';
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const categories = await Product.distinct('category', { isActive: true });
  await cacheSet(cacheKey, categories, TTL_CATEGORIES);
  return categories;
}
Nota: .lean() devuelve POJOs (objetos planos) en vez de documentos Mongoose. Serializa más rápido y evita gastar RAM en métodos. Perfecto para cache.
Paso 9.1.3: Invalidación al cambiar stock en checkout

Importante: el checkout decrementa stock pero no invalida el cache actualmente. Un producto recién comprado seguiría mostrando stock viejo por 60s. Añade invalidación:

javascript
// server/src/services/order.service.js — dentro de checkout, tras commitTransaction
import { cacheInvalidate } from './cache.service.js';

// Después de `await session.commitTransaction()`:
await cacheInvalidate('products:*');
Trade-off: esto invalida todo el catálogo en cada compra. Si tienes 10 compras/min, el cache nunca dura 60s. Alternativa más fina: invalidar solo la key del producto específico:

javascript
await cacheInvalidate(`products:detail:${productId}`);
// Los listados siguen mostrando stock viejo hasta TTL, aceptable
Recomendación: empieza con invalidación fina (por producto). Si los listados muestran stock obsoleto de forma problemática, invalida products:list:* también.

Paso 9.1.4: Verificar con métricas

Añade al endpoint /health la info del cache:

javascript
// server/src/routes/health.routes.js
import { redis } from '../config/redis.js';

router.get('/health', async (req, res) => {
  let cacheOk = false;
  try {
    cacheOk = (await redis.ping()) === 'PONG';
  } catch { /* ignore */ }

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache: cacheOk ? 'connected' : 'unavailable',
  });
});
Test:

bash
# Primera llamada: ~80ms (cache miss)
time curl -s http://localhost:3000/api/products > /dev/null

# Segunda llamada (dentro de 60s): ~5ms (cache hit)
time curl -s http://localhost:3000/api/products > /dev/null

# Verificar la clave en Redis
docker compose exec redis redis-cli KEYS "products:*"
✅ Checklist 9.1:

□ Primera llamada a /products tarda ~80ms, la segunda ~5ms.
□ redis-cli KEYS "products:*" muestra las claves cacheadas.
□ Crear un producto → las claves products:* desaparecen.
□ Admins nunca reciben cache (siempre ven datos frescos).
□ Sin Redis, la app sigue funcionando (cae a DB, solo pierde el speed-up).
🔎 9.2 Meilisearch para Búsqueda Real

Problema con $regex: "iPone" no encuentra "iPhone". Con 1,000 productos, un regex sobre 2 campos tarda ~300ms. Con 10,000, se cae.

Meilisearch: búsqueda con typo-tolerance, sinónimos, relevancia y facetas, en < 50ms.

Paso 9.2.1: Cliente de Meilisearch (server/src/config/meilisearch.js)

javascript
// server/src/config/meilisearch.js
import { MeiliSearch } from 'meilisearch';
import logger from './logger.js';

export const meili = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST,
  apiKey: process.env.MEILISEARCH_API_KEY,
});

export const PRODUCTS_INDEX = 'products';

/**
 * Crea el índice y configura searchable/filterable/sortable attributes.
 * Idempotente: se llama al arrancar el server.
 */
export async function ensureIndexes() {
  try {
    await meili.createIndex(PRODUCTS_INDEX, { primaryKey: 'id' }).catch(() => {
      /* ya existe */
    });

    const index = meili.index(PRODUCTS_INDEX);

    await index.updateSettings({
      searchableAttributes: ['name', 'description', 'category'],
      filterableAttributes: ['category', 'isActive', 'stock', 'price'],
      sortableAttributes: ['price', 'createdAt'],
      rankingRules: [
        'words', 'typo', 'proximity', 'attribute', 'sort', 'exactness',
      ],
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    });

    logger.info('✅ Meilisearch index configurado');
  } catch (err) {
    logger.error({ err }, 'Meilisearch no disponible — búsqueda caerá a regex');
  }
}
Paso 9.2.2: Servicio de indexación (server/src/services/search.service.js)

javascript
// server/src/services/search.service.js
import { meili, PRODUCTS_INDEX } from '../config/meilisearch.js';
import Product from '../models/Product.js';
import logger from '../config/logger.js';

/**
 * Convierte un producto Mongoose a documento de Meilisearch.
 * Solo guardamos lo necesario para búsqueda y filtros.
 */
function toSearchDoc(product) {
  return {
    id: product._id.toString(),
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    stock: product.stock,
    isActive: product.isActive,
    imageUrl: product.images?.card || product.imageUrl || '',
    createdAt: product.createdAt?.toISOString(),
  };
}

export async function indexProduct(product) {
  try {
    await meili.index(PRODUCTS_INDEX).addDocuments([toSearchDoc(product)]);
  } catch (err) {
    logger.error({ err, productId: product._id }, 'Error indexando producto');
  }
}

export async function removeProduct(productId) {
  try {
    await meili.index(PRODUCTS_INDEX).deleteDocument(productId.toString());
  } catch (err) {
    logger.error({ err, productId }, 'Error eliminando producto del índice');
  }
}

/**
 * Reindexación completa. Útil al arrancar el server por primera vez
 * o cuando se añade el índice a un proyecto existente.
 */
export async function reindexAll() {
  try {
    const products = await Product.find({ isActive: true }).lean();
    if (products.length === 0) return;

    await meili.index(PRODUCTS_INDEX).addDocuments(products.map(toSearchDoc));
    logger.info({ count: products.length }, '✅ Reindexados todos los productos');
  } catch (err) {
    logger.error({ err }, 'Error en reindexación completa');
  }
}

/**
 * Busca productos. Devuelve { hits, total, took } o null si Meilisearch falla
 * (para que el caller pueda caer a regex de Mongo).
 */
export async function searchProducts({ q, category, minPrice, maxPrice, sort, page = 1, limit = 12 }) {
  try {
    const filters = ['isActive = true'];
    if (category) filters.push(`category = "${category}"`);
    if (minPrice) filters.push(`price >= ${Number(minPrice)}`);
    if (maxPrice) filters.push(`price <= ${Number(maxPrice)}`);
    if (sort === 'price_asc') filters.push(`price >= 0`); // fuerza index uso

    const sortMap = {
      price_asc: ['price:asc'],
      price_desc: ['price:desc'],
      newest: ['createdAt:desc'],
    };

    const result = await meili.index(PRODUCTS_INDEX).search(q || '', {
      filter: filters.join(' AND '),
      sort: sortMap[sort],
      limit,
      offset: (page - 1) * limit,
      attributesToRetrieve: ['id', 'name', 'description', 'category', 'price', 'imageUrl', 'stock'],
    });

    return {
      hits: result.hits,
      total: result.estimatedTotalHits,
      took: result.processingTimeMs,
    };
  } catch (err) {
    logger.warn({ err }, 'Meilisearch falló, cayendo a regex');
    return null;
  }
}
Paso 9.2.3: Conectar indexación con CRUD de productos

En product.service.js, añade llamadas a indexación después de cada cambio:

javascript
// server/src/services/product.service.js
import { indexProduct, removeProduct } from './search.service.js';

export async function createProduct(data) {
  const slug = await Product.generateSlug(data.name);
  const product = await Product.create({ ...data, slug });

  await cacheInvalidate('products:*');
  await indexProduct(product); // 🔍 indexar

  return product;
}

export async function updateProduct(id, data) {
  if (data.name) data.slug = await Product.generateSlug(data.name);

  const product = await Product.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!product) throw new AppError('Producto no encontrado', 404);

  await cacheInvalidate('products:*');
  await indexProduct(product);

  return product;
}

export async function deleteProduct(id) {
  const product = await Product.findByIdAndUpdate(id, { isActive: false }, { new: true });
  if (!product) throw new AppError('Producto no encontrado', 404);

  await cacheInvalidate('products:*');
  await removeProduct(product._id); // 🔍 quitar del índice

  return product;
}
Paso 9.2.4: Refactorizar listProducts para usar Meilisearch

javascript
// server/src/services/product.service.js
import { searchProducts } from './search.service.js';

export async function listProducts(query, { isAdmin = false } = {}) {
  // Si hay texto de búsqueda y NO es admin, usar Meilisearch
  if (query.q && !isAdmin) {
    const result = await searchProducts(query);

    if (result) {
      // Meilisearch devuelve docs planos. Devolvemos formato consistente.
      const products = result.hits.map((h) => ({
        _id: h.id,
        name: h.name,
        description: h.description,
        category: h.category,
        price: h.price,
        stock: h.stock,
        imageUrl: h.imageUrl,
      }));

      const { page, limit } = parsePagination(query);
      return {
        products,
        meta: buildPaginationMeta({ page, limit, total: result.total }),
      };
    }
    // Si Meilisearch falló, caemos al regex de Mongo (abajo)
  }

  // Fallback: regex de Mongo (sin q o admin o Meilisearch caído)
  // ...resto del código de 9.1.2...
}
Paso 9.2.5: Reindexar al arrancar el server

En server/src/server.js, tras conectar Mongo:

javascript
import { ensureIndexes, reindexAll } from './services/search.service.js';

async function bootstrap() {
  await connectDatabase();
  await ensureIndexes();

  // Reindexar solo si es un entorno nuevo o manual
  if (process.env.REINDEX_ON_START === 'true') {
    await reindexAll();
  }

  app.listen(/* ... */);
}
Y un script manual para reindexar todo:

javascript
// server/src/scripts/reindex.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { ensureIndexes, reindexAll } from '../services/search.service.js';

async function main() {
  await connectDatabase();
  await ensureIndexes();
  await reindexAll();
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
json
// package.json
"scripts": {
  "reindex": "node src/scripts/reindex.js"
}
Paso 9.2.6: Frontend — búsqueda con autocompletado

Añade un endpoint rápido de búsqueda:

javascript
// server/src/controllers/product.controller.js
import { searchProducts } from '../services/search.service.js';

export async function search(req, res, next) {
  try {
    const result = await searchProducts({ ...req.query, limit: 5 });
    if (!result) return res.json({ status: 'success', data: { hits: [] } });
    res.json({ status: 'success', data: { hits: result.hits, took: result.took } });
  } catch (err) { next(err); }
}
javascript
// server/src/routes/product.routes.js
router.get('/search', productController.search);
// ⚠️ Antes de '/:id'
Y en el frontend, reemplaza el input del ProductFilters con autocompletado:

jsx
// client/src/components/SearchAutocomplete.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';

export default function SearchAutocomplete() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
        setResults(data.data.hits);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function goToProduct(id) {
    setOpen(false);
    setQ('');
    navigate(`/product/${id}`);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <input
        type="search"
        className="field__input"
        placeholder="Buscar productos…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
      />
      {open && results.length > 0 && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: '#fff', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)', listStyle: 'none', padding: 0,
          margin: '4px 0 0', boxShadow: 'var(--shadow-md)', zIndex: 100,
        }}>
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => goToProduct(p.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />}
                <span style={{ flex: 1 }}>{p.name}</span>
                <strong>${p.price}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
✅ Checklist 9.2:

□ Buscar "iPone" encuentra "iPhone" (typo tolerance).
□ Búsqueda responde en < 100ms.
□ Crear producto → aparece en búsqueda en < 1s.
□ Eliminar producto → desaparece de búsqueda.
□ Si Meilisearch cae, la app sigue buscando con regex (fallback).
□ npm run reindex reconstruye el índice desde cero.
🌍 9.3 CDN de Imágenes (S3 / R2 + CloudFront)

Problema: hoy el backend sirve /uploads/* desde disco local. Cada descarga consume CPU/bandwidth del server, y es lento para clientes lejanos.

Solución: subir imágenes a S3 (o Cloudflare R2, 10x más barato) y servir desde CloudFront (o el dominio público de R2).

Paso 9.3.1: Abstracción del storage

Crea server/src/services/storage.service.js con 3 drivers:

javascript
// server/src/services/storage.service.js
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../config/logger.js';

const DRIVER = process.env.STORAGE_DRIVER || 'local';
const CDN_URL = process.env.CDN_URL || '';

// ─── Cliente S3 (funciona para AWS y R2) ────────────────
function s3Client() {
  const isR2 = !!process.env.R2_ACCOUNT_ID;
  return new S3Client({
    region: isR2 ? 'auto' : process.env.AWS_S3_REGION,
    endpoint: isR2 ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined,
    credentials: {
      accessKeyId: isR2 ? process.env.R2_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: isR2 ? process.env.R2_SECRET_ACCESS_KEY : process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Sube un archivo (Buffer o ruta local) y devuelve la URL pública.
 * @param {Buffer|string} fileOrPath
 * @param {string} key - Ruta destino (ej. "products/2026-10/abc-thumb.webp")
 * @returns {Promise<string>} URL pública
 */
export async function upload(fileOrPath, key) {
  const body = typeof fileOrPath === 'string' ? await fs.readFile(fileOrPath) : fileOrPath;

  if (DRIVER === 'local') {
    const dest = path.resolve(process.env.UPLOAD_DIR || 'uploads', key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
    return `/uploads/${key}`;
  }

  // S3 o R2
  const bucket = DRIVER === 'r2' ? process.env.R2_BUCKET : process.env.AWS_S3_BUCKET;
  await s3Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  // URL pública
  const base = DRIVER === 'r2' ? process.env.R2_PUBLIC_URL : CDN_URL;
  return `${base}/${key}`;
}

export async function remove(key) {
  if (DRIVER === 'local') {
    try {
      await fs.unlink(path.resolve(process.env.UPLOAD_DIR || 'uploads', key));
    } catch { /* no existía */ }
    return;
  }
  const bucket = DRIVER === 'r2' ? process.env.R2_BUCKET : process.env.AWS_S3_BUCKET;
  try {
    await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    logger.warn({ err, key }, 'Error borrando del storage');
  }
}
Paso 9.3.2: Adaptar processImage para usar storage

Refactoriza server/src/middlewares/upload.middleware.js:

javascript
import { upload } from '../services/storage.service.js';

export async function processImage(buffer, originalName) {
  // ...mismo código de sharp de la Fase 8...

  const urls = {};
  for (const { width, suffix } of SIZES) {
    const targetWidth = Math.min(width, metadata.width);
    const webpBuffer = await sharp(buffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const key = `products/${yearMonth}/${baseName}-${suffix}.webp`;
    const publicUrl = await upload(webpBuffer, key);
    urls[suffix] = publicUrl;
  }

  // Original también al storage
  const originalKey = `products/${yearMonth}/${baseName}-original${ext}`;
  urls.original = await upload(buffer, originalKey);

  return { urls, width: metadata.width, height: metadata.height, baseName };
}
Beneficio inmediato: aunque uses STORAGE_DRIVER=local en desarrollo, la interfaz es la misma. Cambiar a s3 o r2 es solo cambiar la variable de entorno.
Paso 9.3.3: Configurar CloudFront (AWS) o dominio público (R2)

CloudFront (AWS):

Crear distribución → Origin = bucket S3.
Configurar Origin Access Control (OAC) para que el bucket sea privado.
Configurar Cache Policy: TTL 1 año para /products/* (son inmutables, tienen hash en el nombre).
CDN_URL = https://d123abc.cloudfront.net (o dominio custom).
R2 (Cloudflare):

Crear bucket en Cloudflare R2.
Habilitar "Public Access" → te da un https://pub-xxxx.r2.dev.
(Recomendado) Conectar custom domain cdn.tudominio.com para mejor SEO.
R2_PUBLIC_URL = https://pub-xxxx.r2.dev (o https://cdn.tudominio.com).
Paso 9.3.4: Migrar imágenes existentes

Script para mover todo /uploads/* al CDN:

javascript
// server/src/scripts/migrate-images-to-cdn.js
import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDatabase } from '../config/database.js';
import Product from '../models/Product.js';
import { upload } from '../services/storage.service.js';

async function main() {
  await connectDatabase();
  const products = await Product.find({ 'images.card': /^\/uploads\// });

  let migrated = 0;
  for (const p of products) {
    for (const variant of ['thumb', 'card', 'full', 'original']) {
      const url = p.images[variant];
      if (!url?.startsWith('/uploads/')) continue;

      const localPath = path.resolve(process.env.UPLOAD_DIR || 'uploads', url.replace('/uploads/', ''));
      try {
        const buffer = await fs.readFile(localPath);
        const key = url.replace('/uploads/', 'products/');
        p.images[variant] = await upload(buffer, key);
      } catch (err) {
        console.warn(`Skip ${url}:`, err.message);
      }
    }
    await p.save();
    migrated++;
  }

  console.log(`✅ ${migrated} productos migrados al CDN`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
✅ Checklist 9.3:

□ Con STORAGE_DRIVER=local: todo funciona igual que antes.
□ Con STORAGE_DRIVER=r2: las imágenes se sirven desde cdn.tudominio.com (o el dominio público de R2).
□ El backend no recibe peticiones /uploads/* (salvo en modo local).
□ Tiempo de carga de imagen desde Europa < 200ms (probado con VPN).
□ Lighthouse no ve imágenes del server (todas desde CDN).
🔄 9.4 Migraciones Versionadas con migrate-mongo

Problema: cuando cambias el schema en prod, no puedes simplemente editar el modelo. Necesitas scripts que corran en orden, versionados y revertibles.

Paso 9.4.1: Configurar migrate-mongo

bash
cd server
npx migrate-mongo init
Esto crea migrate-mongo-config.js en la raíz del server. Edítalo:

javascript
// server/migrate-mongo-config.js
import 'dotenv/config';

const config = {
  mongodb: {
    url: process.env.MONGODB_URI,
    databaseName: '', // se toma de la URL
    options: {
      // Sin opciones extra
    },
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'esm',
};

export default config;
Paso 9.4.2: Crear la primera migración (retroactiva)

La primera migración debería reflejar los cambios ya aplicados en Fase 7 y 8. Ejemplo:

bash
npx migrate-mongo create add-terms-and-images-to-users-and-products
javascript
// server/migrations/20261021000000-add-terms-and-images-to-users-and-products.js
export const up = async (db) => {
  // 1. Usuarios existentes: aceptar términos retroactivamente
  await db.collection('users').updateMany(
    { acceptedTermsAt: { $exists: false } },
    {
      $set: {
        acceptedTermsAt: new Date(),
        termsVersion: '1.0-legacy',
        twoFactorEnabled: false,
      },
    }
  );

  // 2. Productos: migrar imageUrl → images{}
  const products = await db.collection('products').find({ imageUrl: { $ne: '' } }).toArray();
  for (const p of products) {
    await db.collection('products').updateOne(
      { _id: p._id },
      {
        $set: {
          'images.thumb': p.images?.thumb || p.imageUrl,
          'images.card': p.images?.card || p.imageUrl,
          'images.full': p.images?.full || p.imageUrl,
          'images.original': p.images?.original || p.imageUrl,
        },
      }
    );
  }

  // 3. Órdenes: añadir subtotal si no existe
  await db.collection('orders').updateMany(
    { subtotal: { $exists: false } },
    [
      {
        $set: {
          subtotal: {
            $subtract: ['$total', { $ifNull: ['$shippingAmount', 0] }],
          },
          taxAmount: { $ifNull: ['$taxAmount', 0] },
          shippingAmount: { $ifNull: ['$shippingAmount', 0] },
        },
      },
    ]
  );
};

export const down = async (db) => {
  // Revertir (opcional pero recomendado documentarlo)
  // Aquí es complicado restaurar los datos originales, así que
  // documentamos que el down es "no-op" para migraciones de datos.
  console.warn('⚠️ Esta migración modifica datos, no se puede revertir automáticamente');
};
Paso 9.4.3: Ejecutar migraciones

bash
# Aplicar todas las migraciones pendientes
npx migrate-mongo up

# Ver estado
npx migrate-mongo status

# Revertir la última (si el down está implementado)
npx migrate-mongo down
Paso 9.4.4: Integrar en el deploy

En Docker/docker-compose: añade un servicio one-shot que corre antes del server:

yaml
  migrate:
    build: ./server
    environment:
      MONGODB_URI: mongodb://mongo:27017/e_commerce_01?replicaSet=rs0
    command: ["npx", "migrate-mongo", "up"]
    depends_on:
      mongo-init:
        condition: service_completed_successfully
    restart: "no"

  server:
    depends_on:
      migrate:
        condition: service_completed_successfully
      # ...resto
En GitHub Actions (deploy a Render): añade un step antes de disparar el deploy:

yaml
      - name: Run migrations
        working-directory: server
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
        run: |
          npm ci
          npx migrate-mongo up
✅ Checklist 9.4:

□ npx migrate-mongo status muestra la migración aplicada.
□ La colección changelog en Mongo tiene el registro.
□ Un deploy nuevo corre migrate-mongo up antes de arrancar el server.
□ Revertir la última migración funciona (si se implementó down).
□ Los cambios de schema en código van acompañados de su migración.
📖 9.5 OpenAPI / Swagger

Problema: sin documentación, un dev nuevo (o tú en 6 meses) tiene que leer código para saber qué hace cada endpoint.

Paso 9.5.1: Definir la spec (server/src/docs/openapi.js)

javascript
// server/src/docs/openapi.js
import swaggerJsdoc from 'swagger-jsdoc';

export const openapiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'e_commerce_01 API',
      version: '1.0.0',
      description: 'API RESTful de la plataforma de ecommerce e_commerce_01',
    },
    servers: [
      { url: 'http://localhost:3000/api', description: 'Desarrollo' },
      { url: 'https://api.e_commerce_01.com/api', description: 'Producción' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Product: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number' },
            stock: { type: 'integer' },
            category: { type: 'string' },
            imageUrl: { type: 'string' },
            images: {
              type: 'object',
              properties: {
                thumb: { type: 'string' },
                card: { type: 'string' },
                full: { type: 'string' },
              },
            },
            isActive: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'error' },
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'], // Extrae JSDoc de las rutas
});
Paso 9.5.2: Documentar endpoints en las rutas

javascript
// server/src/routes/product.routes.js
/**
 * @openapi
 * /products:
 *   get:
 *     summary: Lista productos activos (público)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: Lista paginada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     products:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Product' }
 *                     meta: { type: object }
 *   post:
 *     summary: Crea un producto (admin)
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Product' }
 *     responses:
 *       201:
 *         description: Producto creado
 *       401: { description: No autenticado }
 *       403: { description: No autorizado }
 */
router.get('/', optionalAuth, productController.list);
router.post('/', protect, admin, productBodyValidators, validate, productController.create);
Documentar todas las rutas manualmente es tedioso. Para proyectos grandes, considera openapi-typescript-codegen o auto-generadores como tsoa (pero requiere TS).
Paso 9.5.3: Exponer Swagger UI

javascript
// server/src/app.js
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi.js';

if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
} else {
  // En producción, proteger con auth
  app.use('/api/docs', protect, admin, swaggerUi.serve, swaggerUi.setup(openapiSpec));
}
Visita http://localhost:3000/api/docs. Tendrás:

Try it out para cada endpoint.
Generación de cliente TypeScript (openapi-typescript).
Validación de contratos (con openapi-typescript-codegen o swagger-parser).
Paso 9.5.4: Generar tipos TypeScript para el frontend

bash
cd client
npm install --save-dev openapi-typescript
npx openapi-typescript http://localhost:3000/api/docs-json -o src/types/api.d.ts
Ahora el frontend tiene autocompletado tipado:

typescript
import type { paths } from './types/api';

type ProductListResponse = paths['/products']['get']['responses']['200']['content']['application/json'];
// Autocompletado en el editor 🎉
✅ Checklist 9.5:

□ http://localhost:3000/api/docs muestra Swagger UI.
□ Todos los endpoints críticos están documentados.
□ "Try it out" funciona con token JWT.
□ En producción, /api/docs requiere admin.
□ Los tipos del frontend se generan desde OpenAPI (si usas TS).
💱 9.6 Multi-Moneda Real

Problema: el modelo tiene currency pero siempre es USD. Si vendes a Europa, cobras mal.

Paso 9.6.1: Servicio de tasas de cambio (server/src/services/currency.service.js)

javascript
// server/src/services/currency.service.js
import { cacheGet, cacheSet } from './cache.service.js';
import logger from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

const API_KEY = process.env.EXCHANGE_RATE_API_KEY;
const BASE = process.env.BASE_CURRENCY || 'USD';
const SUPPORTED = (process.env.SUPPORTED_CURRENCIES || 'USD').split(',');
const TTL = Number(process.env.EXCHANGE_RATE_CACHE_TTL) || 3600;

const CACHE_KEY = `currency:rates:${BASE}`;

/**
 * Obtiene las tasas de cambio con cache de 1h.
 * Fallback hardcodeado si la API falla (evita romper la app).
 */
export async function getExchangeRates() {
  const cached = await cacheGet(CACHE_KEY);
  if (cached) return cached;

  let rates;
  try {
    const res = await fetch(
      `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${BASE}`
    );
    const data = await res.json();
    if (data.result !== 'success') throw new Error('API error');

    rates = {};
    for (const currency of SUPPORTED) {
      if (data.conversion_rates[currency]) {
        rates[currency] = data.conversion_rates[currency];
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Exchange rate API falló, usando fallback');
    // Fallback estático (aceptable por 1h, se reintenta en próxima llamada)
    rates = { USD: 1, EUR: 0.92, MXN: 17.5, ARS: 1000, COP: 4000 };
  }

  await cacheSet(CACHE_KEY, rates, TTL);
  return rates;
}

/**
 * Convierte un monto de la moneda base a la moneda target.
 */
export async function convert(amount, targetCurrency) {
  if (targetCurrency === BASE) return amount;

  const rates = await getExchangeRates();
  const rate = rates[targetCurrency];

  if (!rate) {
    throw new AppError(`Moneda no soportada: ${targetCurrency}`, 400);
  }

  return Math.round(amount * rate * 100) / 100;
}
Paso 9.6.2: Endpoint de tasas

javascript
// server/src/routes/currency.routes.js
import { Router } from 'express';
import { getExchangeRates } from '../services/currency.service.js';

const router = Router();

router.get('/rates', async (req, res, next) => {
  try {
    const rates = await getExchangeRates();
    res.json({
      status: 'success',
      data: { base: process.env.BASE_CURRENCY || 'USD', rates },
    });
  } catch (err) { next(err); }
});

export default router;
Paso 9.6.3: Currency Context en el frontend

jsx
// client/src/context/CurrencyContext.jsx
import { createContext, useState, useEffect, useContext } from 'react';
import api from '../services/api.js';

const CurrencyContext = createContext(null);

const STORAGE_KEY = 'preferred_currency';

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'USD'
  );
  const [rates, setRates] = useState({ USD: 1 });

  useEffect(() => {
    api.get('/currency/rates')
      .then(({ data }) => setRates(data.data.rates))
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, currency);
  }, [currency]);

  /**
   * Convierte un monto de USD (moneda base) a la moneda actual.
   */
  function convert(amountInBase) {
    const rate = rates[currency] || 1;
    return amountInBase * rate;
  }

  /**
   * Formatea un monto YA convertido a la moneda actual.
   */
  function format(amountInBase) {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(convert(amountInBase));
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates, convert, format }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency debe usarse dentro de <CurrencyProvider>');
  return ctx;
}
Paso 9.6.4: Selector de moneda en el header

jsx
// client/src/components/CurrencySelector.jsx
import { useCurrency } from '../context/CurrencyContext.jsx';

const CURRENCIES = ['USD', 'EUR', 'MXN', 'ARS', 'COP'];

export default function CurrencySelector() {
  const { currency, setCurrency } = useCurrency();
  return (
    <select
      value={currency}
      onChange={(e) => setCurrency(e.target.value)}
      className="field__input"
      style={{ width: 'auto', padding: '4px 8px', fontSize: 'var(--text-sm)' }}
      aria-label="Moneda"
    >
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
Añádelo en Layout.jsx junto al carrito.

Paso 9.6.5: Usar format() en todos los precios

Reemplaza formatCurrency(price) por format(price) de useCurrency():

jsx
// En ProductListPage, ProductDetailPage, CartPage, etc.
import { useCurrency } from '../context/CurrencyContext.jsx';

function Component() {
  const { format } = useCurrency();
  return <span>{format(product.price)}</span>;
}
Paso 9.6.6: Checkout — Stripe cobra en la moneda del cliente

Ojo: Stripe no permite conversión dinámica. Debes crear el Price en la moneda correspondiente. Estrategia:

Opción A — Cobrar siempre en USD (simple): Stripe no permite cambiar la moneda de una sesión a mitad. Los precios se muestran convertidos en el frontend, pero el cobro real es USD. El banco del usuario convierte. Es la opción de la mayoría de tiendas internacionales.

Opción B — Cobrar en la moneda del usuario (complejo): El backend necesita:

Leer currency de la request.
Convertir cada item al currency seleccionado.
Crear la Stripe Session con esa currency.
javascript
// server/src/services/order.service.js — adaptación de checkout
const userCurrency = req.body.currency || 'USD';

const lineItems = orderItems.map((it) => {
  const amount = userCurrency === 'USD'
    ? it.priceAtPurchase
    : await convert(it.priceAtPurchase, userCurrency);

  return {
    price_data: {
      currency: userCurrency.toLowerCase(),
      product_data: { name: it.name, tax_code: process.env.STRIPE_TAX_CODE },
      unit_amount: Math.round(amount * 100),
    },
    quantity: it.quantity,
  };
});

const stripeSession = await stripe.checkout.sessions.create({
  line_items: lineItems,
  // ...
});
⚠️ Advertencia: Stripe cobra una comisión de conversión (~2%) si la moneda de la sesión difiere de la moneda de tu cuenta. Con opción B, tu margen baja. Muchas tiendas usan opción A (cobrar en moneda base y dejar que el banco convierta) para evitarlo.
Recomendación: empieza con opción A (más simple, sin pérdida de margen). Migra a B solo si el negocio lo exige y el volumen lo justifica.

✅ Checklist 9.6:

□ Selector de moneda en el header.
□ Los precios se convierten en tiempo real al cambiar moneda.
□ La preferencia persiste (localStorage).
□ Las tasas se cachean 1h (no saturar la API).
□ Si la API de tasas falla, la app sigue funcionando con el fallback.
✅ 9.7 Checklist Global de la Fase 9

Redis cache

□ Segunda llamada a /products es 10-20x más rápida.
□ Crear/editar/borrar producto invalida cache.
□ Los admins nunca reciben cache.
□ Sin Redis, la app sigue funcionando (con performance degradada).
Meilisearch

□ Buscar "iPone" encuentra "iPhone".
□ Búsqueda responde en < 100ms.
□ CRUD de productos actualiza el índice en < 1s.
□ Fallback a regex si Meilisearch cae.
□ npm run reindex reconstruye el índice.
CDN

□ STORAGE_DRIVER=local funciona igual que antes.
□ STORAGE_DRIVER=r2 (o s3) sirve imágenes desde CDN.
□ Backend no recibe peticiones /uploads/* en modo CDN.
□ Imágenes se cachean 1 año en el edge.
Migraciones

□ npx migrate-mongo status muestra la migración aplicada.
□ npx migrate-mongo up corre en CI antes del deploy.
□ Los cambios de schema tienen su migración.
OpenAPI

□ /api/docs muestra Swagger UI.
□ Endpoints críticos documentados.
□ "Try it out" funciona con JWT.
Multi-currency

□ Selector de moneda visible.
□ Precios se convierten en tiempo real.
□ Tasas se cachean 1h.
□ Checkout maneja la moneda correctamente (según la opción elegida).
Commit

bash
git add .
git commit -m "feat(scale): phase 9 — cache, search, CDN, migrations, docs, multi-currency

- Redis cache-aside for product lists/details with smart invalidation
- Meilisearch index with typo tolerance and autocomplete fallback to regex
- Storage abstraction (local/S3/R2) with CDN URLs and legacy migration script
- migrate-mongo versioned migrations with CI integration
- OpenAPI spec + Swagger UI + TypeScript type generation
- Multi-currency context with exchange-rate caching and selector"
📊 Resumen Visual de la Fase 9

text
┌────────────────────────────────────────────────────────────────┐
│                    ESCALABILIDAD TÉCNICA                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Cliente           Backend                 Servicios           │
│  ┌──────────┐      ┌──────────────┐        ┌──────────────┐   │
│  │ Currency │      │ Express API  │        │  Redis       │   │
│  │ Selector │─────▶│              │───────▶│  (cache)     │   │
│  │          │      │ ┌──────────┐ │        └──────────────┘   │
│  │ Autocomp │      │ │ products │ │        ┌──────────────┐   │
│  │ search   │─────▶│ │ search   │ │───────▶│  Meilisearch │   │
│  └──────────┘      │ └──────────┘ │        └──────────────┘   │
│                    │              │                            │
│                    │ ┌──────────┐ │        ┌──────────────┐   │
│                    │ │ uploads  │ │───────▶│  S3 / R2     │   │
│                    │ └──────────┘ │        │  + CloudFront│   │
│                    │              │        └──────────────┘   │
│                    └──────────────┘                            │
│                            │                                   │
│                            ▼                                   │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  migrate-mongo (schema changes versionados)          │     │
│  │  OpenAPI + Swagger UI (documentación viva)           │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
