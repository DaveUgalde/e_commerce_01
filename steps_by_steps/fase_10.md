Fase 10 Granular: Excelencia de Ingeniería

Esta fase es opcional. Solo tiene sentido si el proyecto va a vivir 5+ años, entra un equipo, o quieres usarlo como referencia profesional. No la hagas si vas a lanzar solo y sin equipo — añade complejidad sin beneficio inmediato.

#	Componente	Cuándo lo necesitas	Resultado
1	TypeScript (migración gradual)	Equipo > 1 dev o > 10k líneas	Bugs atrapados en compile-time
2	Analytics de negocio (PostHog)	Siempre que vendas	Decisiones con datos, no corazonadas
3	Documentación (README, ADRs, Runbook)	Equipo o projecto longevo	Onboarding en 1h, incidentes resueltos en min
4	Tests profundos (Playwright, k6, OWASP ZAP)	Antes de escalar	Confianza para tocar código en prod
Filosofía de esta fase: no es "hacer más cosas", es hacer que el proyecto sea mantenible por otros. Cada componente está pensado para reducir el costo futuro de cambio.

📦 10.0 Prerrequisitos y Estrategia

10.0.1 Decisión previa: ¿merece la pena?

Antes de empezar, hazte estas preguntas:

Pregunta	Si NO	Si SÍ
¿Habrá más de 1 dev en 6 meses?	Salta TypeScript	Migra gradual
¿Necesitas decisiones basadas en datos?	Salta analytics	Implementa PostHog
¿Onboarding toma > 1 día?	Salta documentación profunda	Escribe ADRs + runbook
¿Tocas código en prod sin miedo?	Necesitas E2E + k6	Puedes posponer ZAP
Mi recomendación si estás solo: haz 10.2 (analytics) — el ROI es inmediato y no añade complejidad técnica. Deja TS y tests profundos para cuando escales.

10.0.2 Instalación

Backend (solo si migras a TS):

bash
cd server
npm install --save-dev typescript @types/node @types/express @types/jsonwebtoken @types/bcryptjs @types/cors @types/multer @types/nodemailer @types/bcrypt @types/supertest tsx
Frontend (si migras a TS):

bash
cd client
npm install --save-dev typescript @types/react @types/react-dom
Testing:

bash
# Backend E2E
cd server
npm install --save-dev @playwright/test

# Carga
npm install -g k6  # o descarga binario

# Seguridad
docker pull owasp/zap2docker-stable
Analytics:

bash
cd server
npm install posthog-node

cd ../client
npm install posthog-js
🟦 10.1 Migración Gradual a TypeScript

Regla de oro: no reescribas todo de golpe. Migra módulo a módulo, empezando por los services (donde hay más lógica y los tipos aportan más valor).

Paso 10.1.1: Configurar tsconfig.json con allowJs

Backend:

bash
cd server
npx tsc --init
Reemplaza server/tsconfig.json:

json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
Estrategia allowJs: true: TS compila archivos .js sin chequearlos, pero permite importar .ts desde .js y viceversa. Empiezas por un módulo y el resto sigue en JS.

Scripts (añadir al package.json):

json
{
  "scripts": {
    "dev": "tsx watch src/server.js",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit"
  }
}
tsx es un runner rápido de TS para Node (como ts-node pero más rápido y sin config extra).
Paso 10.1.2: Migración ordenada de módulos

Sigue este orden (de menor a mayor dependencia):

Orden	Módulo	Por qué primero
1	utils/	Sin dependencias, fácil de migrar
2	config/	Tipos de entorno, constantes
3	models/	Interfaces de documentos Mongoose
4	services/	Lógica de negocio, donde TS brilla
5	controllers/	Más verbosos con Request/Response
6	routes/	Últimos (dependen de todo lo anterior)
7	middlewares/	Al final
8	app.js, server.js	Punto de entrada
Ejemplo de migración — utils/AppError.ts:

typescript
// server/src/utils/AppError.ts
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
Ejemplo — services/product.service.ts (tipos explícitos):

typescript
// server/src/services/product.service.ts
import Product, { IProduct } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';
import { cacheGet, cacheSet, cacheInvalidate } from './cache.service.js';
import { parsePagination, buildPaginationMeta, PaginationMeta } from '../utils/pagination.js';

export interface ListProductsQuery {
  page?: string;
  limit?: string;
  category?: string;
  q?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: 'newest' | 'oldest' | 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';
  includeInactive?: string;
}

export interface ListProductsResult {
  products: IProduct[];
  meta: PaginationMeta;
}

export async function listProducts(
  query: ListProductsQuery,
  { isAdmin = false }: { isAdmin?: boolean } = {}
): Promise<ListProductsResult> {
  const { page, limit, skip } = parsePagination(query);
  // ...
}
Modelo con interfaz tipada (models/Product.ts):

typescript
// server/src/models/Product.ts
import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: 'USD' | 'EUR' | 'MXN';
  stock: number;
  imageUrl: string;
  images: {
    thumb: string;
    card: string;
    full: string;
    original: string;
  };
  category: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface IProductModel extends Model<IProduct> {
  generateSlug(name: string): Promise<string>;
}

const productSchema = new Schema<IProduct, IProductModel>(
  { /* ...mismo schema... */ },
  { timestamps: true }
);

productSchema.statics.generateSlug = async function (name: string): Promise<string> {
  // ...
};

const Product = mongoose.model<IProduct, IProductModel>('Product', productSchema);
export default Product;
Paso 10.1.3: Tipos compartidos entre frontend y backend

Crea una carpeta shared/ en la raíz:

text
e_commerce_01/
├── client/
├── server/
└── shared/
    └── types/
        ├── index.ts
        ├── user.ts
        ├── product.ts
        ├── cart.ts
        └── order.ts
shared/types/product.ts:

typescript
export interface Product {
  _id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: 'USD' | 'EUR' | 'MXN';
  stock: number;
  imageUrl: string;
  images: {
    thumb: string;
    card: string;
    full: string;
    original: string;
  };
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
Uso en backend:

typescript
// server/src/services/product.service.ts
import type { Product } from '../../../shared/types/product.js';
Uso en frontend (requiere configurar el alias en vite.config.ts):

typescript
// client/vite.config.ts
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
typescript
// client/src/hooks/useProducts.ts
import type { Product } from '@shared/types/product';
Configuración en client/tsconfig.json:

json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  }
}
Paso 10.1.4: Migrar el frontend a TS

Vite ya soporta TS nativo. Renombra archivos gradualmente:

bash
# Renombrar progresivamente
mv src/components/Button.jsx src/components/Button.tsx
mv src/context/AuthContext.jsx src/context/AuthContext.tsx
mv src/services/api.js src/services/api.ts
Tipar AuthContext:

typescript
// client/src/context/AuthContext.tsx
interface User {
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  twoFactorEnabled: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ requires2FA?: boolean; tempToken?: string }>;
  register: (name: string, email: string, password: string, acceptedTerms: boolean) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
Tipar el interceptor de Axios:

typescript
// client/src/services/api.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // ...
  }
);
Paso 10.1.5: Reglas de strict: true

El tsconfig con strict: true activa:

Flag	Qué hace	Ejemplo
strictNullChecks	null y undefined son tipos distintos	function f(x: string) no acepta null
noImplicitAny	Variables sin tipo → error	function f(x) → error, debe ser function f(x: string)
strictFunctionTypes	Funciones con parámetros más estrictos	Detecta callbacks mal tipados
strictPropertyInitialization	Las propiedades de clase deben inicializarse	Fuerza a poner ! o asignar en constructor
noUncheckedIndexedAccess	arr[0] puede ser undefined	Fuerza a comprobar antes de usar
Acepta algunos any con justificación, no te obsesiones:

typescript
// Justificado: evento de Stripe tiene tipo dinámico
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processStripeEvent(event: any) { /* ... */ }
Paso 10.1.6: Añadir type-check al CI

yaml
# .github/workflows/ci.yml
- name: Type check (server)
  working-directory: server
  run: npx tsc --noEmit

- name: Type check (client)
  working-directory: client
  run: npx tsc --noEmit
✅ Checklist 10.1:

□ tsconfig.json configurado con strict: true y allowJs: true.
□ Los services/ y models/ están en .ts con tipos explícitos.
□ Los tipos compartidos en shared/types/ se usan en ambos lados.
□ npm run typecheck pasa sin errores.
□ El CI falla si hay errores de tipo.
□ Los any restantes están justificados con comentario.
📊 10.2 Analytics de Negocio con PostHog

El objetivo no es "espiar usuarios", es tomar decisiones con datos: qué productos convertir más, dónde abandonan el checkout, cuánto cuesta adquirir un cliente.

Paso 10.2.1: ¿Por qué PostHog y no Google Analytics?

Criterio	PostHog	Google Analytics 4
Funnel de conversión	✅ Nativo	⚠️ Solo con eventos custom
Session replay	✅ Con masking	❌ (solo con Firebase)
Privacy-first / GDPR	✅ EU hosting disponible	⚠️ Transferencias a US complicadas
Self-hosted	✅ Open source	❌
Coste	1M eventos/mes gratis	Gratis (con sampling)
Paso 10.2.2: Configurar PostHog

Crea cuenta en posthog.com (región EU para GDPR).
Copia tu Project API Key.
env
# server/.env.example
POSTHOG_API_KEY=phc_xxxxxxxxxxxxx
POSTHOG_HOST=https://eu.i.posthog.com

# client/.env.example
VITE_POSTHOG_KEY=phc_xxxxxxxxxxxxx
VITE_POSTHOG_HOST=https://eu.i.posthog.com
Paso 10.2.3: Inicializar PostHog en el frontend

typescript
// client/src/instrument.ts
import posthog from 'posthog-js';

function initPostHog() {
  if (posthog.__loaded) return;
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // evitamos capturar todo, queremos eventos curados
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true, // 🔐 nunca grabar passwords/emails
      maskAllText: false,  // el texto es útil para entender fricción
    },
    persistence: 'localStorage+cookie',
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
    },
  });
}

// Solo inicializar si aceptaron cookies analíticas (Fase 7)
if (localStorage.getItem('cc_cookie')) {
  try {
    const consent = JSON.parse(localStorage.getItem('cc_cookie')!);
    if (consent.categories?.includes('analytics')) {
      initPostHog();
    }
  } catch { /* ignore */ }
}

window.addEventListener('cookies:analytics-accepted', initPostHog);
Paso 10.2.4: Eventos clave a trackear

Crea client/src/lib/analytics.ts:

typescript
// client/src/lib/analytics.ts
import posthog from 'posthog-js';

const isEnabled = () => posthog.__loaded;

export const analytics = {
  // ─── Identity ────────────────────────────────────────
  identify(user: { _id: string; email: string; name: string; role: string }) {
    if (!isEnabled()) return;
    posthog.identify(user._id, {
      email: user.email,
      name: user.name,
      role: user.role,
    });
  },

  reset() {
    if (!isEnabled()) return;
    posthog.reset();
  },

  // ─── Funnel de compra ────────────────────────────────
  productViewed(product: { _id: string; name: string; price: number; category: string }) {
    if (!isEnabled()) return;
    posthog.capture('product_viewed', {
      product_id: product._id,
      product_name: product.name,
      price: product.price,
      category: product.category,
    });
  },

  addToCart(product: { _id: string; name: string; price: number }, quantity: number) {
    if (!isEnabled()) return;
    posthog.capture('add_to_cart', {
      product_id: product._id,
      product_name: product.name,
      price: product.price,
      quantity,
      value: product.price * quantity,
    });
  },

  removeFromCart(productId: string, quantity: number) {
    if (!isEnabled()) return;
    posthog.capture('remove_from_cart', { product_id: productId, quantity });
  },

  checkoutStarted(subtotal: number, itemsCount: number) {
    if (!isEnabled()) return;
    posthog.capture('checkout_started', { subtotal, items_count: itemsCount });
  },

  checkoutCompleted(order: { _id: string; total: number; items: number }) {
    if (!isEnabled()) return;
    posthog.capture('checkout_completed', {
      order_id: order._id,
      total: order.total,
      items_count: order.items,
    });
  },

  // ─── Búsqueda ────────────────────────────────────────
  searchPerformed(query: string, resultsCount: number) {
    if (!isEnabled()) return;
    posthog.capture('search_performed', { query, results_count: resultsCount });
  },

  // ─── Errores de negocio ──────────────────────────────
  checkoutFailed(reason: string) {
    if (!isEnabled()) return;
    posthog.capture('checkout_failed', { reason });
  },
};
Paso 10.2.5: Instrumentar los puntos clave

useCart (al añadir/eliminar):

typescript
// client/src/context/CartContext.tsx
import { analytics } from '../lib/analytics';

const addItem = useCallback(async (product, quantity = 1) => {
  // ...lógica existente...
  analytics.addToCart(product, quantity); // 🔥 trackear
}, [user]);
ProductDetailPage:

typescript
useEffect(() => {
  if (product) {
    analytics.productViewed(product);
  }
}, [product]);
CheckoutPage:

typescript
// Al montar
useEffect(() => {
  analytics.checkoutStarted(total, items.length);
}, []); // eslint-disable-line

// Al pagar exitoso (en OrderSuccessPage)
useEffect(() => {
  if (status === 'paid' && order) {
    analytics.checkoutCompleted({
      _id: order._id,
      total: order.total,
      items: order.items.length,
    });
  }
}, [status, order]);
AuthContext:

typescript
// Al hacer login
analytics.identify(user);

// Al hacer logout
analytics.reset();
Paso 10.2.6: Backend — eventos del servidor

Para eventos que solo el backend conoce (webhooks, órdenes pagadas), usa posthog-node:

typescript
// server/src/config/posthog.js
import { PostHog } from 'posthog-node';

export const posthog = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10000,
    })
  : null;

export async function shutdownPosthog() {
  await posthog?.shutdown();
}
Uso en el webhook de Stripe:

typescript
// server/src/services/webhook.service.js
import { posthog } from '../config/posthog.js';

// Dentro de handleCheckoutCompleted, tras `await order.save()`:
if (posthog) {
  posthog.capture({
    distinctId: order.user.toString(),
    event: 'order_paid',
    properties: {
      order_id: order._id.toString(),
      total: order.total,
      tax_amount: order.taxAmount,
      shipping_amount: order.shippingAmount,
      items_count: order.items.length,
    },
  });
}
Cerrar PostHog limpiamente en SIGTERM:

typescript
// server/src/server.js
import { shutdownPosthog } from './config/posthog.js';

const shutdown = (signal) => {
  // ...
  shutdownPosthog().catch(() => {});
  // ...
};
Paso 10.2.7: Dashboard de negocio en /admin/analytics

No necesitas construir tu propio dashboard — PostHog ya lo hace. Pero sí puedes añadir un enlace:

jsx
// client/src/pages/admin/AdminAnalyticsPage.jsx
export default function AdminAnalyticsPage() {
  return (
    <div>
      <h1>Analytics</h1>
      <p>Los dashboards se gestionan en PostHog.</p>
      <a
        href="https://eu.posthog.com/project/123/dashboard"
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn--primary"
      >
        Abrir PostHog →
      </a>

      <section style={{ marginTop: 'var(--space-8)' }}>
        <h2>KPIs clave a monitorizar en PostHog</h2>
        <ul>
          <li><strong>Funnel de conversión:</strong> product_viewed → add_to_cart → checkout_started → checkout_completed</li>
          <li><strong>Ticket promedio:</strong> media de checkout_completed.total</li>
          <li><strong>Tasa de abandono del carrito:</strong> add_to_cart sin checkout_completed en 24h</li>
          <li><strong>Búsquedas sin resultado:</strong> search_performed con results_count = 0</li>
          <li><strong>Checkouts fallidos:</strong> checkout_failed agrupados por reason</li>
        </ul>
      </section>
    </div>
  );
}
Paso 10.2.8: Los 5 dashboards que debes crear en PostHog

Funnel de conversión (por día/semana):

text
product_viewed → add_to_cart → checkout_started → checkout_completed
Ventas:

Ingresos totales por día.
Ticket promedio.
Unidades vendidas por producto.
Productos más vistos vs. más vendidos (detecta problemas de conversión por producto).
Búsquedas sin resultado (qué buscan tus usuarios y no encuentras).
Checkouts fallidos agrupados por reason (siempre "stock insuficiente", tienes un problema de inventario).
✅ Checklist 10.2:

□ PostHog inicializado solo si aceptaron cookies analíticas.
□ Funnel completo trackeado (view → add → checkout → purchase).
□ Los precios y totales coinciden con lo que cobra Stripe.
□ Los eventos backend (webhook) llegan a PostHog.
□ Session replay con maskAllInputs: true (passwords nunca visibles).
□ Los 5 dashboards están creados en PostHog.
□ Los eventos se cierran limpiamente en shutdown (shutdownPosthog).
📚 10.3 Documentación Profunda

Paso 10.3.1: Estructura documental

text
e_commerce_01/
├── README.md                    # Puerta de entrada
├── CONTRIBUTING.md              # Cómo contribuir
├── docs/
│   ├── ARCHITECTURE.md          # Cómo está construido
│   ├── DEPLOYMENT.md            # Cómo desplegar
│   ├── RUNBOOK.md               # Qué hacer en incidentes
│   ├── adr/                     # Architecture Decision Records
│   │   ├── 001-mongodb-vs-postgres.md
│   │   ├── 002-jwt-refresh-tokens.md
│   │   ├── 003-stripe-vs-paypal.md
│   │   └── ...
│   └── api/
│       └── (generado por OpenAPI)
└── .github/
    └── pull_request_template.md
Paso 10.3.2: README maestro

markdown
# 🛒 e_commerce_01

Plataforma Ecommerce completa — React + Node.js + MongoDB.

## Quick Start (5 min)

```bash
# 1. Requisitos
node --version  # >= 20
docker --version

# 2. Clonar y arrancar
git clone <repo>
cd e_commerce_01
cp server/.env.example server/.env
cp client/.env.example client/.env
docker compose up --build -d

# 3. Crear admin inicial
docker compose exec server npm run create-admin

# 4. Visitar
open http://localhost:8080
Arquitectura

Ver docs/ARCHITECTURE.md.

text
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  React SPA  │───▶│  Express    │───▶│  MongoDB    │
│  Vite       │    │  + Redis    │    │  (rs0)      │
└─────────────┘    └──────┬──────┘    └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  Stripe     │
                   │  Meilisearch│
                   │  S3/R2      │
                   └─────────────┘
Comandos

Comando	Descripción
docker compose up	Levanta todo el stack
docker compose exec server npm run seed	Carga productos de prueba
docker compose exec server npm run create-admin	Crea un admin
docker compose exec server npm run migrate	Aplica migraciones
docker compose exec server npm run reindex	Reindexa Meilisearch
docker compose exec server npm test	Tests backend
npm run test:e2e (en client/)	Tests Playwright
Variables de Entorno

Ver docs/DEPLOYMENT.md.

Decisiones Arquitectónicas

Ver docs/adr/.

Contribuir

Ver CONTRIBUTING.md.

Incidentes en Producción

Ver docs/RUNBOOK.md.

text

### Paso 10.3.3: ADRs (Architecture Decision Records)

Un ADR es un **documento corto** que registra una decisión arquitectónica importante: contexto, alternativas, decisión y consecuencias.

**Plantilla `docs/adr/template.md`:**

```markdown
# ADR-XXX: [Título corto de la decisión]

**Fecha:** YYYY-MM-DD
**Estado:** [Propuesto | Aceptado | Deprecado | Reemplazado por ADR-YYY]
**Decisores:** [nombres]

## Contexto

¿Qué problema estamos resolviendo? ¿Qué restricciones hay?

## Alternativas consideradas

### Opción A
- ✅ Pros
- ❌ Cons

### Opción B
- ✅ Pros
- ❌ Cons

## Decisión

Elegimos la **opción X** porque [razón principal].

## Consecuencias

**Positivas:**
- ...

**Negativas (aceptadas):**
- ...

**Neutras:**
- ...
Ejemplo real docs/adr/001-mongodb-vs-postgres.md:

markdown
# ADR-001: MongoDB vs PostgreSQL como base de datos principal

**Fecha:** 2026-09-15
**Estado:** Aceptado
**Decisores:** Ana (backend), Luis (producto)

## Contexto

e_commerce_01 vende productos tecnológicos con atributos variables (smartphones
tienen RAM/almacenamiento, laptops tienen CPU/GPU, accesorios no tienen). El
equipo es pequeño (1-2 devs) y prioriza velocidad de iteración sobre
consistencia estricta.

## Alternativas consideradas

### Opción A: PostgreSQL
- ✅ ACID por defecto, SQL tipado.
- ✅ Excelente para reportes complejos.
- ❌ Schema rígido → cambiar atributos de producto requiere migraciones.
- ❌ JSONB para atributos flexibles es un parche, no nativo.

### Opción B: MongoDB
- ✅ Schema flexible → productos con atributos variables son naturales.
- ✅ Transacciones ACID desde v4.0 (replica set).
- ✅ Agregaciones para reportes son suficientes para el volumen esperado.
- ❌ Sin JOINs nativos → hay que denormalizar (ya lo hacemos con `OrderItem.priceAtPurchase`).
- ❌ Las transacciones requieren replica set (Atlas o Docker con rs0).

## Decisión

**MongoDB** por la naturaleza heterogénea del catálogo. La flexibilidad
de schema ahorra semanas de desarrollo inicial. Los reportes complejos
se resuelven con agregaciones (suficientes para los primeros 2 años).

## Consecuencias

**Positivas:**
- Iteración rápida en el catálogo (nuevos tipos de producto sin migración).
- Stack JS unificado (Mongoose + React).

**Negativas aceptadas:**
- Necesitamos replica set para transacciones (Docker con rs0 o Atlas).
- Los reportes financieros complejos (ej. impuestos por estado) requerirán
  exportar a un data warehouse (planificado para fase 11).

**Neutras:**
- Costo operacional similar a Postgres en Atlas/RDS.
ADRs mínimos recomendados:

001-mongodb-vs-postgres.md
002-jwt-refresh-tokens.md (por qué access 15min + refresh 7d)
003-stripe-vs-paypal.md
004-monorepo-vs-multirepo.md
005-redis-cache-strategy.md
Paso 10.3.4: Runbook de incidentes

docs/RUNBOOK.md:

markdown
# 🚨 Runbook de Incidentes

Guía operacional para resolver los incidentes más probables en producción.
**Tiempo objetivo de detección:** < 5 min. **Resolución:** < 30 min.

## 🚨 Incidente 1: "El sitio está caído"

### Detección
- Alerta de Better Stack `/health` down.
- Alerta de Sentry: pico de 5xx.

### Diagnóstico (en este orden)
1. **Verificar health check:**
   ```bash
   curl -s https://api.tudominio.com/health | jq
Si responde → sitio arriba, problema es de frontend o CDN.
Si no responde → backend caído, ir al paso 2.
Verificar logs en Render/Vercel:

Render dashboard → Logs → filtrar últimos 5 min.
Buscar FATAL, uncaughtException, MongoNetworkError.
Verificar estado de proveedores:

status.render.com
status.mongodb.com
status.stripe.com
Resolución

Provider down: esperar (ya está notificado).
OOM (out of memory): Render reinicia; verificar uso de memoria en dashboard.
Deploy fallido: rollback en Render → Deploys → "Redeploy previous".
Mongo caído: Atlas → verificar cluster → si está suspendido, reactivar.
🚨 Incidente 2: "Los usuarios no pueden pagar"

Detección

Alerta Sentry: checkout_failed > 5%.
Alerta PostHog: checkout_started sin checkout_completed.
Emails de usuarios: "no puedo pagar".
Diagnóstico

Verificar webhook de Stripe:

bash
curl -I https://api.tudominio.com/api/webhooks/stripe
Debe devolver 200 (o 405 si solo acepta POST).
Verificar Stripe dashboard:

dashboard.stripe.com/events → buscar checkout.session.completed recientes.
Si no llegan webhooks → problema de config o red.
Verificar logs backend:

bash
grep "webhook" logs/app.log | tail -50
Resolución

Webhook failing: verificar STRIPE_WEBHOOK_SECRET en .env de prod.
Checkout error 500: revisar Sentry, usualmente es STRIPE_SECRET_KEY expirada.
Stock insuficiente masivo: revisar inventario, bug en decremento.
🚨 Incidente 3: "Las búsquedas no funcionan"

Detección

Sentry: errores en /products/search.
PostHog: search_performed con results_count: 0 elevado.
Diagnóstico

Verificar Meilisearch:

bash
curl http://meilisearch:7700/health
Verificar índice:

bash
curl -H "Authorization: Bearer $MEILISEARCH_API_KEY" \
  http://meilisearch:7700/indexes/products/stats
Si numberOfDocuments: 0 → índice vacío, reindexar.
Resolución

Meilisearch caído: docker restart meilisearch.
Índice vacío:

bash
docker compose exec server npm run reindex
Fallback automático a regex: el código ya lo hace si Meilisearch falla. Verificar que funciona.
🚨 Incidente 4: "Base de datos desconectada"

Detección

Alerta Telegram /ready → 503.
Logs: MongoNetworkError.
Diagnóstico

Verificar Atlas dashboard: cluster status.
Verificar IP allowlist: tu IP de Render puede cambiar.
Verificar conexiones: Atlas free tier tiene límite de ~500 conexiones.
Resolución

Allowlist: añadir 0.0.0.0/0 (Render usa IPs dinámicas) o configurar VPC peering.
Conexiones agotadas: aumentar pool size en Atlas o reducir conexiones del server.
Cluster suspendido: reactivar en Atlas.
🚨 Incidente 5: "Cobros duplicados reportados"

Diagnóstico (CRÍTICO, prioridad máxima)

Verificar idempotencia del webhook:

javascript
// En webhook.service.js, handleCheckoutCompleted
if (order.status !== 'pending') {
  logger.info('Orden ya procesada');
  return; // ya es idempotente
}
Verificar en Stripe: eventos checkout.session.completed duplicados con mismo payment_intent.
Verificar DB:

bash
mongosh "$MONGODB_URI" --eval '
  db.orders.aggregate([
    { $group: { _id: "$stripePaymentIntentId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ])
'
Resolución

Si hay duplicados: reembolsar manualmente en Stripe, marcar orden como cancelled.
Bug de idempotencia: revisar que stripeSessionId tenga índice único en DB.
📞 Escalación

Nivel	Quién	Cuándo
L1	Sentry + alertas	Automático
L2	Dev de guardia	Alerta disparada
L3	Tech lead	30 min sin resolver
L4	Proveedor (Stripe/Mongo/Cloudflare)	Incidente de proveedor
Post-mortem (obligatorio para incidentes > 1h)

Crear docs/postmortems/YYYY-MM-DD-titulo.md con:

Timeline de detección y resolución.
Impacto (usuarios, ingresos perdidos).
Causa raíz (5 whys).
Acciones de prevención con owner y fecha límite.
text

### Paso 10.3.5: `CONTRIBUTING.md`

```markdown
# Contribuir a e_commerce_01

## Setup de desarrollo (15 min)

```bash
git clone <repo>
cd e_commerce_01
cp server/.env.example server/.env
cp client/.env.example client/.env

# Backend
cd server && npm install && npm run dev

# Frontend (otra terminal)
cd client && npm install && npm run dev
Flujo de trabajo

Crea una rama descriptiva:

bash
git checkout -b feat/coupon-system
# o
git checkout -b fix/checkout-tax-calc
feat/ para features
fix/ para bugs
refactor/ para refactor sin cambio funcional
docs/ para documentación
Antes de commitear:

bash
npm run lint
npm run typecheck
npm test
Commits con Conventional Commits:

text
feat(cart): add coupon support
fix(checkout): correct tax calculation for EU
docs(adr): document Stripe vs PayPal decision
Push y PR:

El PR debe llenar la plantilla.
Requiere CI verde.
Requiere 1 aprobación (o auto-merge si eres solo).
Convenciones de código

Nombres: camelCase variables, PascalCase componentes/clases, UPPER_SNAKE constantes.
Archivos: kebab-case excepto componentes React (PascalCase.tsx).
Imports: absolutos primero (@shared, @/components), luego relativos.
Sin any salvo justificación comentada.
Nunca commitear .env, secretos, ni credenciales.
Checklist del PR

□ Tests pasan (npm test).
□ Type check pasa (npm run typecheck).
□ No hay console.log de debug.
□ Si añade endpoints → documentados en OpenAPI.
□ Si cambia schema → migración migrate-mongo.
□ Si añade dependencia → justificada en el PR.
□ Si cambia UI → captura antes/después en el PR.
text

### Paso 10.3.6: Plantilla de PR

`.github/pull_request_template.md`:

```markdown
## Descripción
<!-- ¿Qué hace este PR? ¿Por qué? -->

## Tipo de cambio
- [ ] Bug fix
- [ ] Nueva feature
- [ ] Refactor
- [ ] Documentación
- [ ] Breaking change

## Cómo testear
<!-- Pasos para verificar manualmente -->

## Checklist
- [ ] Tests añadidos/actualizados
- [ ] Documentación actualizada
- [ ] Migración de DB (si aplica)
- [ ] Variables de entorno nuevas en `.env.example`
- [ ] Screenshots (si es UI)

## Notas para el reviewer
<!-- Contexto adicional, decisiones, dudas -->
✅ Checklist 10.3:

□ README con quick start < 5 min.
□ Mínimo 5 ADRs documentando decisiones pasadas.
□ Runbook cubre los 5 incidentes más probables.
□ CONTRIBUTING con flujo claro.
□ Plantilla de PR que fuerza calidad.
□ Un dev nuevo levanta el proyecto en < 1h siguiendo el README.
🧪 10.4 Tests Profundos

Paso 10.4.1: E2E con Playwright

Setup:

bash
cd client
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
client/playwright.config.ts:

typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
Test E2E: flujo completo de compra.

client/e2e/purchase.spec.ts:

typescript
import { test, expect } from '@playwright/test';

test.describe('Flujo completo de compra', () => {
  const email = `e2e-${Date.now()}@test.com`;

  test('usuario puede registrarse, añadir producto y llegar a Stripe', async ({ page }) => {
    // 1. Registro
    await page.goto('/register');
    await page.fill('#name', 'E2E User');
    await page.fill('#email', email);
    await page.fill('#password', 'Password123');
    await page.check('input[type="checkbox"]'); // acepto T&C
    await page.click('button[type="submit"]');

    // 2. Catálogo
    await page.waitForURL('/');
    await page.goto('/products');
    await expect(page.locator('article').first()).toBeVisible();

    // 3. Añadir al carrito
    const addButton = page.locator('article').first().locator('button', { hasText: 'Añadir al carrito' });
    await addButton.click();
    await expect(page.getByRole('status')).toContainText('añadido');

    // 4. Ir al carrito
    await page.goto('/cart');
    await expect(page.locator('text=Añadir al carrito')).not.toBeVisible();

    // 5. Checkout
    await page.click('text=Proceder al pago');
    await page.waitForURL('/checkout');

    // 6. Rellenar dirección
    await page.fill('#street', 'Calle Falsa 123');
    await page.fill('#city', 'Springfield');
    await page.fill('#state', 'IL');
    await page.fill('#postalCode', '62704');
    await page.fill('#country', 'US');
    await page.fill('#phone', '+1 555 123 4567');

    // 7. Pagar
    await page.click('button[type="submit"]');

    // 8. Verificar redirección a Stripe
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 10000 });
  });

  test('búsqueda con typo encuentra el producto', async ({ page }) => {
    await page.goto('/products');
    await page.fill('input[type="search"]', 'iPone'); // typo intencional
    await expect(page.locator('article').first()).toContainText('iPhone', { timeout: 3000 });
  });

  test('accesibilidad: navegación con teclado en checkout', async ({ page }) => {
    await page.goto('/cart'); // asumiendo carrito pre-poblado
    await page.keyboard.press('Tab');
    // ... verificar orden de foco
    // ...
  });
});
Tests críticos a cubrir:

Test	Qué valida
Registro + login	Flujo de auth
Añadir/eliminar carrito	Estado del carrito
Checkout hasta Stripe	Integración completa
Webhook de Stripe (mock)	Orden pasa a paid
Cambio de estado admin	Máquina de estados
Búsqueda con typo	Meilisearch funciona
404 custom	Manejo de errores
Mobile viewport	Responsive básico
Scripts:

json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:report": "playwright show-report"
  }
}
En CI:

yaml
- name: E2E tests
  working-directory: client
  env:
    BASE_URL: http://localhost:8080
  run: |
    npm ci
    npx playwright install --with-deps
    npm run test:e2e
Paso 10.4.2: Tests de carga con k6

Instalar:

bash
# macOS
brew install k6
# Linux
sudo apt install k6
# O descarga binario: https://k6.io/docs/getting-started/installation/
k6/load-test.js:

javascript
// k6/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 20 },  // ramp up
    { duration: '3m', target: 100 }, // sustenido
    { duration: '1m', target: 200 }, // pico
    { duration: '1m', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% < 500ms
    http_req_failed: ['rate<0.01'],     // < 1% errores
    'http_req_duration{endpoint:products}': ['p(95)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';

export default function () {
  // 1. Listar productos (endpoint más caliente, cacheado)
  const productsRes = http.get(`${BASE_URL}/products?limit=12`, {
    tags: { endpoint: 'products' },
  });
  check(productsRes, {
    'products 200': (r) => r.status === 200,
    'products < 200ms': (r) => r.timings.duration < 200,
  });
  sleep(1);

  // 2. Detalle de producto
  const products = productsRes.json('data.products');
  if (products && products.length > 0) {
    const id = products[0]._id;
    const detailRes = http.get(`${BASE_URL}/products/${id}`, {
      tags: { endpoint: 'product-detail' },
    });
    check(detailRes, { 'detail 200': (r) => r.status === 200 });
    sleep(1);
  }

  // 3. Búsqueda
  const searchRes = http.get(`${BASE_URL}/products/search?q=iphone`, {
    tags: { endpoint: 'search' },
  });
  check(searchRes, { 'search 200': (r) => r.status === 200 });
  sleep(2);
}
Escenario de checkout (más crítico):

javascript
// k6/checkout-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:checkout}': ['p(95)<1000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api';

export function setup() {
  // Crear N usuarios y devolver tokens
  const users = [];
  for (let i = 0; i < 50; i++) {
    const email = `load-${i}-${Date.now()}@test.com`;
    http.post(`${BASE_URL}/auth/register`, JSON.stringify({
      name: `User ${i}`, email, password: 'Password123', acceptedTerms: true,
    }), { headers: { 'Content-Type': 'application/json' } });

    const login = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
      email, password: 'Password123',
    }), { headers: { 'Content-Type': 'application/json' } });

    users.push({ email, token: login.json('data.token') });
  }
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];

  const res = http.post(`${BASE_URL}/orders/checkout`, JSON.stringify({
    shippingAddress: {
      street: 'x', city: 'y', state: 'z', postalCode: '1', country: 'US', phone: '1',
    },
  }), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user.token}`,
    },
    tags: { endpoint: 'checkout' },
  });

  // 200 (éxito) o 400 (carrito vacío) son aceptables
  check(res, {
    'checkout not 5xx': (r) => r.status < 500,
  });
}
Ejecutar:

bash
# Smoke test (1 VU, 30s)
k6 run --vus 1 --duration 30s k6/load-test.js

# Load test completo
k6 run --env BASE_URL=https://api.staging.tudominio.com k6/load-test.js

# Ver resultados en tiempo real: k6 imprime p50/p95/p99 automáticamente
Objetivos mínimos:

Endpoint	p95	p99
GET /products	< 200ms	< 500ms
GET /products/:id	< 100ms	< 300ms
GET /products/search	< 100ms	< 300ms
POST /orders/checkout	< 1000ms	< 2000ms
Paso 10.4.3: OWASP ZAP (seguridad)

Scan básico con Docker:

bash
# Baseline scan (10-15 min)
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://staging.tudominio.com \
  -r zap-report.html

# Full scan (más lento, más profundo)
docker run -t owasp/zap2docker-stable zap-full-scan.py \
  -t https://staging.tudominio.com \
  -r zap-full-report.html
En CI (.github/workflows/security.yml):

yaml
name: Security Scan
on:
  schedule:
    - cron: '0 3 * * 1' # lunes 03:00 UTC
  workflow_dispatch:

jobs:
  zap:
    runs-on: ubuntu-latest
    steps:
      - name: ZAP Baseline Scan
        uses: zaproxy/action-baseline@v0.12.0
        with:
          target: 'https://staging.tudominio.com'
          rules_file_name: '.zap/rules.tsv'
          cmd_options: '-a'
.zap/rules.tsv (reglas a ignorar, por falsos positivos):

tsv
10038	IGNORE	(Security Headers - CSP report-only, es intencional)
10063	IGNORE	(Permissions Policy - no aplica)
Interpretar resultados:

Código	Nivel	Acción
High	Critical	Bloquear release. Arreglar antes de merge.
Medium	Serious	Arreglar en la siguiente sprint.
Low	Warning	Documentar como deuda técnica si aplica.
Informational	—	Ignorar o usar para hardenizar.
✅ Checklist 10.4:

□ Playwright cubre los 5 flujos críticos (registro, compra, admin, búsqueda, a11y).
□ Los E2E corren en CI en cada PR.
□ k6 verifica que POST /orders/checkout aguanta 50 concurrentes.
□ k6 detecta cache hit (products < 200ms p95).
□ OWASP ZAP corre semanalmente, sin alerts High.
□ Los reportes se publican como artifacts del CI.
✅ 10.5 Checklist Global de la Fase 10

TypeScript

□ tsconfig.json con strict: true en backend y frontend.
□ services/, models/, utils/ migrados a .ts.
□ Tipos compartidos en shared/types/ usados por ambos lados.
□ npm run typecheck verde.
□ Los any restantes justificados.
Analytics

□ PostHog solo carga si aceptaron cookies analíticas.
□ Funnel completo trackeado (view → add → checkout → purchase).
□ Eventos backend (webhooks) llegan a PostHog.
□ 5 dashboards creados en PostHog.
□ Session replay con masking de inputs.
Documentación

□ README con quick start < 5 min.
□ 5 ADRs documentando decisiones pasadas.
□ Runbook cubre los 5 incidentes más probables.
□ CONTRIBUTING claro.
□ Un dev nuevo levanta el proyecto en < 1h.
Tests

□ Playwright E2E en CI con 5 flujos cubiertos.
□ k6 verifica p95 de los endpoints críticos.
□ OWASP ZAP semanal sin alerts High.
□ Los reportes se archivan como artifacts.
Commit final

bash
git add .
git commit -m "feat(engineering): phase 10 — TypeScript, analytics, docs, deep testing

- Gradual TypeScript migration with shared types between client and server
- PostHog analytics with GDPR-compliant loading and funnel dashboards
- ADRs, runbook, CONTRIBUTING and PR template
- Playwright E2E covering critical flows, k6 load tests, OWASP ZAP in CI"
📊 Resumen Visual de la Fase 10

text
┌────────────────────────────────────────────────────────────────┐
│                  EXCELENCIA DE INGENIERÍA                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ TypeScript   │  │ PostHog      │  │ Documentación    │    │
│  │ strict: true │  │ Analytics    │  │ README + ADRs    │    │
│  │ shared/types │  │ 5 dashboards │  │ Runbook          │    │
│  └──────────────┘  └──────────────┘  └──────────────────┘    │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ Playwright   │  │ k6           │  │ OWASP ZAP        │    │
│  │ E2E flows    │  │ Load tests   │  │ Security scan    │    │
│  │ CI artifacts │  │ p95 < 500ms  │  │ sin alerts High  │    │
│  └──────────────┘  └──────────────┘  └──────────────────┘    │
│                                                                │
│  → Onboarding < 1h                                             │
│  → Bugs atrapados en compile-time                              │
│  → Decisiones con datos                                        │
│  → Confianza para tocar código en prod                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
🎯 Criterio de salida de la Fase 10

"Cualquier dev se incorpora en 1h, el sistema escala a 100k usuarios sin reescribir, y las decisiones están documentadas."
Cuándo NO hacer esta fase:

Estás solo y el proyecto es de portafolio → con Fase 9 ya es impresionante.
No tienes equipo ni prevés tenerlo en 12 meses → adelanta el ROI y vuelve cuando aparezca el problema real.
Necesitas features de negocio antes que "calidad técnica" → prioriza vender.
Cuándo SÍ hacerla:

Entra un segundo dev este trimestre.
Planeas vender la empresa o levantar capital (la due diligence técnica pesa).
Vas a mantener el proyecto 3+ años.
🏁 Cierre del Roadmap Completo

Has completado el viaje de 10 fases que convierten un proyecto vacío en un ecommerce de producción real. Recapitulando:

Fase	Logro	Estado
0	Setup del monorepo	✅
1	Autenticación con JWT	✅
2	Catálogo + carrito + checkout transaccional	✅
3	Checkout UI + admin + sistema de diseño	✅
4	UX polish + uploads + tests + Docker	✅
5	Stripe + refresh tokens + password reset + emails	✅
6	Observabilidad (Sentry, alertas, backups, cron, colas)	✅
7	Legal + seguridad (T&C, cookies, 2FA, CSP, rate limiting)	✅
8	UX profesional (imágenes, envío, a11y, SEO)	✅
9	Escalabilidad (cache, search, CDN, migraciones, OpenAPI)	✅
10	Excelencia de ingeniería (TS, analytics, docs, deep testing)	✅
