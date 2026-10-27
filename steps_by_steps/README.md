# 🛒 e_commerce_01

> Plataforma Ecommerce completa y lista para producción, construida desde cero con **React** y **Node.js**.  
> Checkout transaccional, pagos reales con Stripe, refresh tokens, panel admin, observabilidad, cache, búsqueda con typo-tolerance y CI/CD automatizado.

[![CI](https://github.com/usuario/e_commerce_01/actions/workflows/ci.yml/badge.svg)](https://github.com/usuario/e_commerce_01/actions/workflows/ci.yml)
[![Deploy](https://github.com/usuario/e_commerce_01/actions/workflows/deploy.yml/badge.svg)](https://github.com/usuario/e_commerce_01/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

**🔗 Demo:** [https://e_commerce_01.demo.com](https://e_commerce_01.demo.com)  
**👤 Credenciales demo:** `demo@e_commerce_01.com` / `Demo12345`  
**👑 Admin demo:** `admin@e_commerce_01.com` / `Admin12345`

---

## 📖 Tabla de Contenidos

- [✨ Features](#-features)
- [🏗️ Arquitectura](#️-arquitectura)
- [🚀 Quick Start](#-quick-start)
- [📁 Estructura del Proyecto](#-estructura-del-proyecto)
- [🧰 Stack Tecnológico](#-stack-tecnológico)
- [🧠 Decisiones Técnicas Clave](#-decisiones-técnicas-clave)
- [🛣️ Roadmap de Implementación (10 Fases)](#️-roadmap-de-implementación-10-fases)
- [🔌 API Endpoints](#-api-endpoints)
- [🧪 Testing](#-testing)
- [📊 Performance](#-performance)
- [🔐 Seguridad](#-seguridad)
- [⚖️ Cumplimiento Legal](#️-cumplimiento-legal)
- [🚀 Deployment](#-deployment)
- [⚙️ Variables de Entorno](#️-variables-de-entorno)
- [📚 Documentación Adicional](#-documentación-adicional)
- [🎓 Lo que Aprendí](#-lo-que-aprendí)
- [📄 Licencia](#-licencia)

---

## ✨ Features

### Para clientes
- 🛍️ **Catálogo** con búsqueda (typo-tolerance vía Meilisearch), filtros por categoría/precio y paginación.
- 🛒 **Carrito** persistente: funciona como invitado (localStorage) y como usuario autenticado (servidor), con merge automático al hacer login.
- 💳 **Checkout transaccional** con reserva atómica de stock y pago real con Stripe.
- 📦 **Historial de pedidos** con estados en tiempo real (`pending → paid → shipped → delivered`).
- 🌍 **Multi-moneda** (USD, EUR, MXN, ARS, COP) con tasas de cambio en tiempo real.
- 📧 **Emails transaccionales**: bienvenida, confirmación de pedido, cambios de estado, reset de contraseña.
- ♿ **Accesibilidad AA**: navegación completa por teclado, contraste WCAG, `aria` labels.
- 🌐 **SEO optimizado**: meta tags dinámicas, Open Graph, `sitemap.xml` dinámico.
- 🔐 **Seguridad**: refresh tokens rotados, 2FA opcional, sesión persistente sin re-login.

### Para administradores
- 📊 **Panel admin** con CRUD de productos, gestión de pedidos y cambio de estados.
- 🖼️ **Optimización automática de imágenes** con `sharp` (3 tamaños WebP + `srcset`).
- 📝 **Editor de productos** con preview y subida de imagen.
- 🔒 **2FA con TOTP** (obligatorio para admins en producción).
- 📈 **Analytics** con PostHog (funnel, conversión, session replay con masking).

### Para operaciones
- 🐛 **Sentry** en backend y frontend con PII scrubbing y source maps.
- 🔔 **Alertas activas** en Telegram: errores 5xx, `/ready` caído, cron fallido.
- 💾 **Backups automáticos** de MongoDB a S3/R2 con restore probado.
- 📡 **Uptime monitoring** externo (Better Stack / UptimeRobot).
- 🧹 **Cron de órdenes huérfanas**: expira `pending > 24h` y restaura stock.
- 📧 **Cola de emails** (BullMQ + Redis) con reintentos exponenciales.
- 📊 **Logs estructurados** con `pino` y `reqId` por request.
- 🩺 **Health checks**: `/health` (liveness) y `/ready` (readiness con DB).

---

## 🏗️ Arquitectura
┌───────────────────────────────────────────────────────────────────────┐
│ e_commerce_01 │
├───────────────────────────────────────────────────────────────────────┤
│ │
│ ┌─────────────────┐ ┌──────────────────┐ │
│ │ React SPA │ │ Express API │ │
│ │ Vite │◀──HTTPS▶│ JWT + Refresh │ │
│ │ React Router │ │ Rate limiting │ │
│ │ Context API │ │ Validation │ │
│ │ Lazy + Suspense│ │ Pino logger │ │
│ └────────┬────────┘ └────────┬─────────┘ │
│ │ │ │
│ │ │ │
│ ▼ ▼ │
│ ┌────────────────┐ ┌───────────────────┐ │
│ │ PostHog │ │ MongoDB │ │
│ │ (analytics) │ │ (replica set) │ │
│ │ Sentry │ │ Transacciones │ │
│ └────────────────┘ └─────────┬─────────┘ │
│ │ │
│ ┌─────────┴──────────┐ │
│ ▼ ▼ │
│ ┌──────────────────┐ ┌──────────────────┐ │
│ │ Redis │ │ Meilisearch │ │
│ │ Cache + Queues │ │ Search │ │
│ └──────────────────┘ └──────────────────┘ │
│ │
│ ┌────────────────┐ ┌───────────────────┐ │
│ │ S3 / R2 │ │ Stripe │ │
│ │ + CDN │ │ Checkout + Tax │ │
│ │ (imágenes) │ │ Webhooks │ │
│ └────────────────┘ └───────────────────┘ │
│ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ CI/CD: GitHub Actions → Render (API) + Vercel (Frontend) │ │
│ └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘

text

**Flujo de una compra:**
Cliente → añade al carrito → checkout
│
▼
Backend: transacción atómica
├─ Reserva stock (findOneAndUpdate)
├─ Crea Order (status: pending)
├─ Vacía carrito
└─ Commit
│
▼
Stripe Checkout Session
│
▼
Cliente paga en Stripe
│
▼
Stripe → Webhook firmado
│
▼
Backend: verifica firma
├─ Idempotencia check
├─ Order → paid
├─ Email de confirmación
└─ PostHog capture order_paid
│
▼
Cliente redirigido a /orders/success
(polling hasta que status === paid)

text

---

## 🚀 Quick Start

### Requisitos
- Node.js `>= 20`
- Docker `>= 24`
- Git

### Instalación (5 minutos)

```bash
# 1. Clonar
git clone https://github.com/usuario/e_commerce_01.git
cd e_commerce_01

# 2. Configurar variables de entorno
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Editar server/.env (mínimo: JWT_SECRET, JWT_REFRESH_SECRET, STRIPE_SECRET_KEY)
#    Puedes generar los secrets con:
#    openssl rand -hex 48

# 4. Levantar todo el stack
docker compose up --build -d

# 5. Crear admin inicial
docker compose exec server npm run create-admin

# 6. Cargar productos de prueba
docker compose exec server npm run seed

# 7. Abrir
open http://localhost:8080
Desarrollo sin Docker

bash
# Terminal 1 — Backend
cd server
npm install
cp .env.example .env  # editar
npm run dev           # :3000

# Terminal 2 — Frontend
cd client
npm install
npm run dev           # :5173
📁 Estructura del Proyecto

text
e_commerce_01/
├── client/                    # Frontend React
│   ├── src/
│   │   ├── components/        # Componentes reutilizables
│   │   ├── context/           # AuthContext, CartContext, ToastContext, CurrencyContext
│   │   ├── hooks/             # useAuth, useCart, useToast, useCurrency
│   │   ├── pages/             # Vistas por ruta
│   │   ├── services/          # api.js (Axios + interceptores)
│   │   ├── utils/             # formatters, validators
│   │   └── main.jsx           # Entry point
│   ├── e2e/                   # Playwright tests
│   └── vite.config.js
│
├── server/                    # Backend Node.js
│   ├── src/
│   │   ├── config/            # database, logger, redis, stripe, meilisearch, email, posthog
│   │   ├── controllers/       # Auth, products, cart, orders, shipping
│   │   ├── middlewares/       # protect, admin, validate, rateLimit, upload, httpLogger
│   │   ├── models/            # User, Product, Cart, Order
│   │   ├── queues/            # BullMQ email queue
│   │   ├── routes/            # Express routes
│   │   ├── services/          # Lógica de negocio (auth, product, cart, order, ...)
│   │   ├── scripts/           # backup, restore, seed, reindex, migrate
│   │   ├── utils/             # AppError, jwt, pagination
│   │   ├── app.js             # Express app
│   │   └── server.js          # Entry point
│   ├── tests/                 # node:test + supertest
│   ├── migrations/            # migrate-mongo
│   └── Dockerfile
│
├── shared/                    # Tipos compartidos (TS)
│   └── types/
│
├── k6/                        # Load tests
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   ├── RUNBOOK.md
│   ├── ARCHITECTURE.md
│   └── DEPLOYMENT.md
│
├── .github/
│   └── workflows/             # ci.yml, deploy.yml, backup.yml
│
├── docker-compose.yml
└── README.md
🧰 Stack Tecnológico

Capa	Tecnología	Versión
Frontend	React	18
Vite	5
React Router	6
Context API + useReducer	—
Axios	—
Backend	Node.js	20 LTS
Express	4
Mongoose	8
JWT (access + refresh)	—
bcryptjs	—
express-validator	—
Helmet	—
express-rate-limit	—
BullMQ	—
Pino	—
Multer + Sharp	—
Base de datos	MongoDB	7 (replica set)
Redis	7
Meilisearch	1.9
Servicios externos	Stripe (Checkout + Tax + Webhooks)	—
AWS S3 / Cloudflare R2	—
Resend / Ethereal / SMTP	—
Sentry	—
PostHog	—
Better Stack	—
Telegram Bot API	—
Testing	node:test	—
Supertest	—
Playwright	—
k6	—
OWASP ZAP	—
CI/CD	GitHub Actions	—
Docker + docker-compose	—
Render (API)	—
Vercel (Frontend)	—
migrate-mongo	—
OpenAPI + Swagger	—
🧠 Decisiones Técnicas Clave

Cada decisión arquitectónica está documentada en docs/adr/. Aquí las más importantes:

1. Checkout transaccional con decremento atómico

Problema: dos usuarios compran la última unidad simultáneamente. Con read-then-write, ambos leen stock: 1, ambos escriben stock: 0 → se vende 2 veces.

Solución:

javascript
const updated = await Product.findOneAndUpdate(
  { _id: productId, stock: { $gte: quantity } },
  { $inc: { stock: -quantity } },
  { new: true, session }
);
if (!updated) throw new AppError('Stock insuficiente', 409);
findOneAndUpdate con filtro $gte es atómico a nivel documento. Solo uno pasa; el otro recibe null y hace rollback.

Verificado con: test de concurrencia (10 usuarios, stock 1 → 1 éxito, 9 conflictos).

2. Webhooks idempotentes

Stripe puede reenviar webhooks. handleCheckoutCompleted verifica order.status !== 'pending' antes de procesar. Resultado: cero cobros duplicados.

3. Refresh tokens con detección de reuso

Access token: 15 min (en localStorage).
Refresh token: 7 días (en cookie httpOnly).
Al refrescar, se rota el token en DB.
Si alguien usa un refresh token viejo (robado), se invalida toda la sesión.
4. Cache-aside con invalidación inteligente

GET /products cachea en Redis por 60s. Crear/editar/borrar producto invalida products:*. Resultado: 95% menos queries a Mongo con datos siempre frescos.

5. Cola de emails

Los emails van a una cola (BullMQ) con 3 reintentos exponenciales. El registro responde en < 200ms aunque SMTP esté caído. Los fallos se ven en Bull Board.

6. Soft delete de productos

DELETE /products/:id no borra: marca isActive: false. Preserva integridad referencial con órdenes históricas. Regla de oro del ecommerce: nunca borres datos que un pedido histórico referencia.

7. Snapshots históricos en órdenes

OrderItem guarda priceAtPurchase y name. Si el producto cambia de precio o se renombra, la orden histórica no se altera. Igual con shippingAddress en Order.

8. Cálculo de totales en servidor

El frontend nunca envía precios. El backend recalcula el total desde Product.price + Shipping.calculate(). Previene manipulación del cliente.

🛣️ Roadmap de Implementación (10 Fases)

Este proyecto se construyó en 10 fases incrementales. Cada fase añadió una capa de valor:

Fase 0 — Setup del proyecto

Monorepo client/ + server/.
Express + Vite + MongoDB (con Docker).
Estructura base, health check, .env management.
Fase 1 — Autenticación

Modelo User con hash de contraseña (bcryptjs, rounds 12).
JWT access tokens.
Registro, login, GET /auth/me.
Middlewares protect y admin.
Fase 2 — Catálogo y carrito

Modelos Product (con slug, soft delete), Cart, Order.
CRUD de productos (admin).
Carrito con $inc/$push atómicos.
Checkout transaccional con reserva de stock.
Test de concurrencia.
Fase 3 — UI y panel admin

Sistema de diseño (tokens CSS + componentes).
Checkout con errores por campo.
Historial de pedidos.
Admin de productos.
Fase 4 — UX y producción

Toasts, skeletons, code splitting.
Manejo de sesión expirada sin perder formulario.
Filtros avanzados, admin de pedidos.
Upload de imágenes con Multer.
Tests backend + Docker Compose.
Fase 5 — Production readiness

Stripe Checkout + webhooks firmados.
Refresh tokens con rotación.
Recuperación de contraseña.
Emails transaccionales (Nodemailer).
Logs estructurados (Pino).
CI/CD con GitHub Actions.
Fase 6 — Operación confiable

Sentry backend + frontend con source maps.
Alertas Telegram (5xx, /ready, cron fallido).
Backups automáticos a S3 con restore probado.
Uptime monitoring externo.
Cron de órdenes huérfanas (expira pending > 24h).
Cola de emails con BullMQ.
Fase 7 — Legal y seguridad avanzada

Términos, privacidad, cookies, devoluciones.
Cookie consent GDPR (vanilla-cookieconsent).
Stripe Tax con cálculo automático de IVA.
2FA TOTP para admins con códigos de recuperación.
CSP afinado + securityheaders.com nota A.
Rate limiting por usuario + Redis.
Fase 8 — UX de compra pulida

Optimización de imágenes con sharp (3 WebP + srcset).
Cálculo de envío por país con umbral de envío gratis.
Emails en cada cambio de estado.
Accesibilidad AA (Lighthouse ≥ 95).
SEO (Helmet, sitemap, Open Graph).
Página 404 custom.
Fase 9 — Escalabilidad técnica

Redis cache con invalidación inteligente.
Meilisearch para búsqueda con typo-tolerance.
CDN de imágenes (S3/R2 + CloudFront).
Migraciones versionadas (migrate-mongo).
OpenAPI + Swagger UI.
Multi-moneda con tasas en tiempo real.
Fase 10 — Excelencia de ingeniería

Migración gradual a TypeScript con tipos compartidos.
PostHog analytics (funnel, session replay con masking).
Documentación: ADRs, runbook, CONTRIBUTING.
Tests profundos: Playwright E2E, k6 load tests, OWASP ZAP.
🔌 API Endpoints

Documentación completa e interactiva en /api/docs (Swagger UI).

Autenticación

Método	Endpoint	Auth	Descripción
POST	/auth/register	—	Crear cuenta (requiere acceptedTerms: true)
POST	/auth/login	—	Login (devuelve requires2FA si aplica)
POST	/auth/2fa/verify	—	Verificar código TOTP
POST	/auth/2fa/setup	admin	Generar secreto + QR
POST	/auth/2fa/confirm	admin	Confirmar y activar
POST	/auth/refresh	cookie	Rotar refresh token
POST	/auth/logout	✅	Invalidar sesión
GET	/auth/me	✅	Usuario actual
POST	/auth/forgot-password	—	Solicitar reset
POST	/auth/reset-password	—	Resetear con token
Productos

Método	Endpoint	Auth	Descripción
GET	/products	opcional	Listar con filtros (?q=&category=&sort=&page=)
GET	/products/categories	—	Categorías únicas
GET	/products/search	—	Búsqueda rápida (Meilisearch)
GET	/products/:id	—	Detalle
POST	/products	admin	Crear
PUT	/products/:id	admin	Actualizar
DELETE	/products/:id	admin	Soft delete
Carrito

Método	Endpoint	Auth	Descripción
GET	/cart	✅	Obtener carrito
POST	/cart/items	✅	Añadir item
PATCH	/cart/items/:productId	✅	Actualizar cantidad
DELETE	/cart/items/:productId	✅	Eliminar item
DELETE	/cart	✅	Vaciar carrito
Pedidos

Método	Endpoint	Auth	Descripción
POST	/orders/checkout	✅	Iniciar checkout → URL de Stripe
GET	/orders	✅	Mis pedidos
GET	/orders/:id	✅	Detalle de pedido
GET	/orders/:id/status	✅	Polling de estado (para frontend)
GET	/orders/by-session/:sessionId	✅	Buscar por Stripe Session
GET	/orders/admin	admin	Todos los pedidos
PATCH	/orders/admin/:id/status	admin	Cambiar estado
Otros

Método	Endpoint	Auth	Descripción
GET	/health	—	Liveness probe
GET	/ready	—	Readiness (con DB)
GET	/sitemap.xml	—	Sitemap dinámico
POST	/webhooks/stripe	firma	Webhook de Stripe
POST	/uploads/product-image	admin	Subir imagen (3 WebP)
GET	/currency/rates	—	Tasas de cambio
GET	/shipping/info	—	Info de envíos
🧪 Testing

Backend

bash
cd server
npm test
node:test + Supertest.
Tests de auth, productos, checkout.
Test de concurrencia (10 usuarios vs 1 unidad → 1 éxito, 9 conflictos).
Frontend E2E

bash
cd client
npm run test:e2e
Playwright en Chromium + iPhone 13.
Flujos cubiertos: registro, compra completa, admin, búsqueda con typo, a11y.
Load tests

bash
k6 run k6/load-test.js
k6 run k6/checkout-test.js
Escenario escalado: 20 → 100 → 200 VUs.
Thresholds: p95 < 500ms, p95 checkout < 1000ms.
Security scan

bash
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://staging.tudominio.com
Sin alerts High/Critical.
Corre semanalmente en CI.
📊 Performance

Métricas reales medidas con k6 y Lighthouse (staging, región US-East):

Endpoint	p50	p95	p99
GET /products (cache hit)	3ms	12ms	45ms
GET /products (cache miss)	45ms	80ms	150ms
GET /products/search	15ms	40ms	90ms
GET /products/:id	5ms	18ms	55ms
POST /orders/checkout	280ms	480ms	850ms
POST /auth/login	85ms	120ms	200ms
Lighthouse (mobile, throttled 4G):

Categoría	Catálogo	Producto	Checkout
Performance	94	92	91
Accessibility	98	98	96
Best Practices	100	100	100
SEO	100	100	100
Load test (200 VUs concurrentes, 5 min):

Throughput: ~800 req/s.
Error rate: 0.02%.
Sin degradación progresiva (memory estable).
🔐 Seguridad

✅ Contraseñas con bcrypt (rounds 12).
✅ JWT access 15min + refresh 7d con rotación y detección de reuso.
✅ Cookies httpOnly, secure, sameSite=strict.
✅ Helmet con CSP afinado para Stripe.
✅ HSTS con preload.
✅ Rate limiting por usuario (Redis) + por IP.
✅ 2FA TOTP obligatorio para admins (en producción).
✅ express-validator en todos los endpoints.
✅ PII scrubbing en Sentry (nunca viajan passwords).
✅ npm audit --audit-level=high en CI.
✅ Dependabot activo.
✅ OWASP ZAP semanal sin alerts High.
Score en securityheaders.com: A

⚖️ Cumplimiento Legal

✅ Términos y Condiciones (/legal/terms).
✅ Política de Privacidad (/legal/privacy) — GDPR compliant.
✅ Política de Cookies (/legal/cookies).
✅ Política de Devoluciones (/legal/returns) — 14 días UE.
✅ Aceptación obligatoria de T&C en registro (con termsVersion).
✅ Cookie consent real (vanilla-cookieconsent): analytics solo con opt-in.
✅ Stripe Tax con IVA/sales tax calculado automáticamente.
✅ Derecho al olvido (GDPR art. 17) documentado en el runbook.
🚀 Deployment

Infraestructura recomendada

Componente	Proveedor	Plan
Frontend	Vercel	Hobby
Backend	Render	Starter
MongoDB	Atlas	M10 (backups automáticos)
Redis	Upstash	Pay-as-you-go
Meilisearch	Meilisearch Cloud	Starter
Imágenes	Cloudflare R2	Pay-as-you-go
Sentry	Sentry	Developer
PostHog	PostHog Cloud (EU)	Free (1M events/mo)
Deploy automático

En cada push a main:

CI corre: lint, typecheck, tests backend, build frontend.
Si verde → Deploy:

Render: redeploy con docker build.
Vercel: vercel deploy --prod.
Migraciones: migrate-mongo up antes de arrancar.
Alertas de deploy a Telegram.
Ver docs/DEPLOYMENT.md para el paso a paso.

⚙️ Variables de Entorno

Ver server/.env.example y client/.env.example.

Mínimas para desarrollo:

env
# Backend
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/e_commerce_01
JWT_SECRET=<openssl rand -hex 48>
JWT_REFRESH_SECRET=<openssl rand -hex 48>
CLIENT_ORIGIN=http://localhost:5173
REDIS_URL=redis://127.0.0.1:6379
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
Generar secrets:

bash
openssl rand -hex 48
📚 Documentación Adicional

Documento	Descripción
docs/ARCHITECTURE.md	Visión profunda de la arquitectura
docs/DEPLOYMENT.md	Guía de deployment a producción
docs/RUNBOOK.md	Guía operacional de incidentes
docs/adr/	Architecture Decision Records
CONTRIBUTING.md	Cómo contribuir al proyecto
CHANGELOG.md	Historial de cambios por release
/api/docs	Swagger UI con OpenAPI spec
🎓 Lo que Aprendí

Este proyecto fue construido desde cero para dominar el stack de producción real. Los retos más difíciles:

1. La trampa del stock

El primer checkout que escribí tenía una race condition que me costó 2 días detectar. El test de concurrencia (10 usuarios, 1 unidad → solo 1 debe ganar) fue la herramienta más valiosa del proyecto. Enseñó que "funciona en mi máquina" no significa nada si no se prueba bajo carga real.

2. Webhooks: la fuente de verdad

Al principio intenté marcar órdenes como paid cuando el frontend decía "listo". Error: un usuario malicioso podía manipular la petición y obtener producto gratis. Aprendí que el backend nunca confía en el cliente, y que Stripe es la única fuente de verdad del pago.

3. La sesión expirada

Un usuario que tarda 20 minutos llenando el checkout descubre que su token expiró y pierde todos los datos. La solución (refresh tokens silenciosos + sessionStorage del formulario) parecía trivial al principio pero tiene decenas de casos borde.

4. Observabilidad != Logs

Antes solo hacía console.log. Después de Sentry, alertas y reqId, entendí que "loguear" y "saber qué está pasando" son cosas distintas. Poder decir "este error pasó 47 veces con reqId xyz en la ruta /api/checkout" en 5 segundos no tiene precio.

5. Legal es técnico

Stripe Tax no es solo una línea de código. Es un sistema completo de registrations por país, tax codes y manejo de edge cases (envío como line item separado, exenciones). Aprendí que cumplimiento legal es parte del desarrollo, no un "extra".

6. Cache ≠ magia

La primera vez que añadí Redis cache, el catálogo mostraba productos borrados durante 60s. Aprendí la importancia de la invalidación de cache y que un KEYS * en producción es un crimen (usar SCAN).

7. TypeScript no es opcional a escala

Los primeros 3 meses fue JS puro. Al llegar a 10k líneas, sin tipos los bugs saltaban en runtime en lugar de compile-time. La migración gradual a TS me ahorró horas de debugging.

8. El runbook importa más que el código

Cuando algo falla en producción, no tienes tiempo de leer 3000 líneas. Un RUNBOOK.md con "si /ready devuelve 503, haz X" salva el día. La documentación operacional es tan importante como el código.

📄 Licencia

MIT © Tu Nombre

🙏 Agradecimientos

Stripe por una API de pagos que hace lo difícil fácil.
MongoDB por las transacciones ACID nativas.
Meilisearch por un motor de búsqueda open source brutal.
Sentry y PostHog por hacer observabilidad accesible.
Better Stack por el uptime monitoring gratuito.
La comunidad de Node.js y React por 10 años de ecosistema.
⭐ Si este proyecto te resultó útil, dale una estrella en GitHub.

text

---

## 📌 Cómo usar este README

### Ajustes que debes hacer antes de commitear

1. **Reemplaza los placeholders:**
   - `usuario` → tu username de GitHub
   - `Tu Nombre` → tu nombre real
   - `e_commerce_01.demo.com` → tu URL real de demo
   - `Demo12345` → credenciales reales del entorno demo

2. **Los badges:** activa GitHub Actions en el repo para que se muestren. Si aún no lo has activado, comenta las líneas de badge.

3. **Métricas de performance:** reemplaza los números con **tus mediciones reales**. No copies los que puse; son ilustrativos. Corre k6 en tu deploy y anota los resultados.

4. **Demo funcional:** si no vas a hostear una demo pública, **elimina esa sección**. Un reclutador que entra a un link roto es peor que uno que no encuentra link.

5. **Añade capturas de pantalla** en una sección `## 📸 Screenshots` después de "Features". Un README con imágenes convierte 3x más.

---

## 🎯 Consejos para el portafolio

### El README es tu primer filtro

Un reclutador pasa **< 30 segundos** en tu repo antes de decidir si sigue. Este README está diseñado para:

- **Primeros 5 segundos:** badges verdes + demo + credenciales → "este proyecto está vivo".
- **Primeros 30 segundos:** features + arquitectura + decisiones técnicas → "sabe lo que hace".
- **Primeros 2 minutos:** fases + performance + testing → "esto es serio".

### Lo que hace la diferencia

- **Los números.** "p95 de 45ms" impresiona más que "es rápido".
- **El video/case study.** Linkear a un post explicando el checkout transaccional te separa del 95%.
- **La honestidad.** La sección "Lo que aprendí" reconoce que tuviste bugs. Eso es señal de seniority, no de debilidad.

### Lo que NO hacer

- ❌ **No mientas con las métricas.** Si no corriste k6 con 200 VUs, no lo pongas.
- ❌ **No infles el stack.** Si solo tocaste Redis para el cache, no digas "experto en Redis".
- ❌ **No olvides el video.** Es lo que más convierte en entrevistas.

---

## 📁 Archivos que complementan este README

Para que el proyecto se vea completo, crea estos archivos en el repo:

| Archivo | Propósito | Prioridad |
| :--- | :--- | :---: |
| `docs/RUNBOOK.md` | Guía de incidentes (creado en Fase 10) | 🔥 Alta |
| `docs/ARCHITECTURE.md` | Diagrama y decisiones técnicas | 🔥 Alta |
| `docs/adr/001-*.md` | Mínimo 5 ADRs | 🔥 Alta |
| `CONTRIBUTING.md` | Guía para contribuir | 🟡 Media |
| `CHANGELOG.md` | Historial de versiones | 🟡 Media |
| `LICENSE` | MIT (o la que elijas) | 🔥 Alta |
| `.github/pull_request_template.md` | Plantilla de PRs | 🟡 Media |
| `docs/DEPLOYMENT.md` | Guía de deploy paso a paso | 🟡 Media |
| `docs/postmortems/` | Post-mortems de incidentes reales | 🟢 Baja |

---

## 🏁 Resumen 

Este README es **tu carta de presentación al mundo**. No es solo documentación técnica: es la primera impresión que un reclutador, colaborador o usuario va a tener de tu trabajo.

Con este README + el proyecto desplegado + los 2 case studies que escribas, tienes un **portafolio de nivel mid-senior** que:

- ✅ Demuestra dominio técnico real (no solo "seguí un tutorial").
- ✅ Muestra capacidad de explicar decisiones (ADRs + "Lo que aprendí").
- ✅ Prueba que sabes llevar software a producción (observabilidad, legal, testing).
- ✅ Comunica con claridad (estructura del README, badges, diagramas).

**Copia este README a tu repo, ajusta los placeholders, añade screenshots y súbelo.** Con eso, el proyecto pasa de "algo que hiciste" a "algo que puedes mostrar con orgullo". 🚀