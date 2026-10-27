
___________________________________________________________
🧪 FASE 10 — Excelencia de Ingeniería (Opcional pero recomendada)

📖 1. La Historia (El Porqué)

La fase 10 convierte supuestos de calidad en pruebas y evidencia. No es una lista decorativa de herramientas: cada herramienta debe responder una pregunta concreta sobre el sistema.

Puntos críticos a entender en esta fase:

Analítica con Consentimiento (PostHog): Queremos saber qué productos se ven o dónde abandonan los usuarios el carrito. Sin embargo, la ley exige que no rastreemos a los usuarios hasta que acepten las cookies. PostHog solo se inicializa si el usuario hizo clic en "Aceptar todo".
Playwright (E2E): Simula a un usuario real en un navegador real (Chromium). Nos dice si la tienda funciona de principio a fin (Registro → Compra → Admin → 2FA) sin que un humano tenga que hacerlo manualmente. Añadimos speakeasy al test para generar el código TOTP en vivo.
k6 (Carga): Responde a la pregunta "¿Aguanta la API 200 usuarios concurrentes?". Se ejecuta en un entorno controlado y mide la latencia p95 (el 95% de las peticiones deben tardar menos de X milisegundos).
ZAP (Seguridad): Escanea la app en busca de vulnerabilidades conocidas (XSS, inyecciones). Se ejecuta semanalmente sobre staging.
Documentación y ADRs: Un Architecture Decision Record (ADR) explica por qué se tomó una decisión (ej. ¿Por qué MongoDB y no Postgres?). Ayuda a que los futuros desarrolladores entiendan el sistema.
___________________________________________________________
📋 2. El Checklist (El Qué)

□ Dependencias: Instalar posthog-node, posthog-js, @playwright/test, speakeasy.
□ PostHog Backend: Configurar posthog.ts y trackear order_paid en el webhook.
□ PostHog Frontend: Crear analytics.ts (consent-gated) e instrumentar eventos (view, add, checkout).
□ Playwright: Crear playwright.config.ts y los tests (purchase.spec.ts, admin-2fa.spec.ts, a11y.spec.ts).
□ k6: Crear load-test.js y checkout-test.js.
□ ZAP: Crear .github/workflows/security.yml.
□ Documentación: Crear README.md, CONTRIBUTING.md, docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, 5 ADRs, y PR template.
□ CI: Añadir el job de E2E a .github/workflows/ci.yml.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 10.1: Dependencias
___________________________________________________________
cd server && npm install posthog-node
cd ../client && npm install posthog-js && npm install -D @playwright/test speakeasy
___________________________________________________________
Paso 10.2: Analítica (PostHog)

Backend: server/src/config/posthog.ts
___________________________________________________________
import { PostHog } from 'posthog-node';

export const posthog = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST,
});

export async function shutdownPosthog() {
  await posthog.shutdown();
}
___________________________________________________________
Actualizar server/src/server.ts (Graceful Shutdown)
___________________________________________________________
import { shutdownPosthog } from './config/posthog.js';

const shutdown = async (signal: string) => {
  // ...
  await shutdownPosthog();
  // ...
};
___________________________________________________________
Backend: server/src/services/webhook.service.ts (Trackear pago)
___________________________________________________________
import { posthog } from '../config/posthog.js';

// Dentro del event 'checkout.session.completed', después de guardar la orden:
posthog.capture({
  distinctId: session.metadata.orderId,
  event: 'order_paid',
  properties: {
    total: order.total,
    tax: order.taxAmount,
    shipping: order.shippingAmount,
  },
});
___________________________________________________________
Frontend: client/src/lib/analytics.ts
___________________________________________________________
import posthog from 'posthog-js';

let initialized = false;

function hasAnalyticsConsent(): boolean {
  const match = document.cookie.match(/(?:^|; )cc_cookie=([^;]*)/);
  if (!match) return false;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return parsed.categories?.includes('analytics') ?? false;
  } catch { return false; }
}

export function initAnalyticsIfConsented() {
  if (initialized || !hasAnalyticsConsent()) return;
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    autocapture: false,
  });
  initialized = true;
}

export const analytics = {
  productViewed: (p: any) => initialized && posthog.capture('product_viewed', { id: p.id, name: p.name }),
  addToCart: (p: any, qty: number) => initialized && posthog.capture('add_to_cart', { id: p.id, qty }),
  checkoutStarted: () => initialized && posthog.capture('checkout_started'),
  checkoutCompleted: (o: any) => initialized && posthog.capture('checkout_completed', { id: o.id, total: o.total }),
};
___________________________________________________________
Actualizar client/src/App.tsx
___________________________________________________________
import { useEffect } from 'react';
import { initAnalyticsIfConsented } from './lib/analytics';

// Dentro del componente App:
useEffect(() => {
  window.addEventListener('analytics:consent', initAnalyticsIfConsented);
  initAnalyticsIfConsented();
}, []);
___________________________________________________________
Paso 10.3: Playwright (E2E)

client/playwright.config.ts
___________________________________________________________
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  use: { 
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173', 
    trace: 'on-first-retry' 
  },
});
___________________________________________________________
client/e2e/purchase.spec.ts
___________________________________________________________
import { test, expect } from '@playwright/test';

test('flujo completo de compra', async ({ page }) => {
  const email = `e2e${Date.now()}@test.com`;
  
  // 1. Registro
  await page.goto('/register');
  await page.fill('input[name=name]', 'E2E User');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Password1');
  await page.check('input[name=acceptedTerms]'); // Fase 7
  await page.click('button[type=submit]');
  
  // 2. Login (porque el registro no loguea automáticamente)
  await page.goto('/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Password1');
  await page.click('button[type=submit]');

  // 3. Añadir al carrito
  await page.goto('/products');
  await page.click('button.add-to-cart >> nth=0');
  
  // 4. Checkout
  await page.goto('/cart');
  await page.click('text=Proceder al pago');
  await page.fill('input[name="name"]', 'E2E User');
  await page.fill('input[name="street"]', 'Calle 123');
  await page.fill('input[name="city"]', 'Bogotá');
  await page.fill('input[name="phone"]', '3001234567');
  await page.click('text=Pagar');
  
  // 5. Stripe Checkout
  await expect(page).toHaveURL(/checkout\.stripe\.com/);
});
___________________________________________________________
client/e2e/admin-2fa.spec.ts
___________________________________________________________
import { test, expect } from '@playwright/test';
import speakeasy from 'speakeasy';

test('login de admin con 2FA', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', process.env.ADMIN_EMAIL!);
  await page.fill('input[name=password]', process.env.ADMIN_PASSWORD!);
  await page.click('button[type=submit]');

  // Generar TOTP real con speakeasy
  const code = speakeasy.totp({ 
    secret: process.env.ADMIN_TOTP_SECRET!, 
    encoding: 'base32' 
  });
  
  await page.fill('input[name=code]', code);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/admin/products');
});
___________________________________________________________
Paso 10.4: k6 (Pruebas de Carga)

k6/load-test.js
___________________________________________________________
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp up
    { duration: '1m', target: 200 },  // Carga pico
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    'http_req_duration{endpoint:products}': ['p(95)<500'], // p95 < 500ms
  },
};

export default function () {
  const base = __ENV.BASE_URL ?? 'http://localhost:3000/api';
  const res = http.get(`${base}/products`, { tags: { endpoint: 'products' } });
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}
___________________________________________________________
k6/checkout-test.js
___________________________________________________________
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: { 'http_req_duration{endpoint:checkout}': ['p(95)<1000'] },
};

export function setup() {
  const tokens = [];
  for (let i = 0; i < 50; i++) {
    http.post('http://localhost:3000/api/auth/register', JSON.stringify({
      email: `k6-${i}@test.com`, name: `K6-${i}`, password: 'Password1', acceptedTerms: true,
    }), { headers: { 'Content-Type': 'application/json' } });
    
    const login = http.post('http://localhost:3000/api/auth/login', JSON.stringify({
      email: `k6-${i}@test.com`, password: 'Password1',
    }), { headers: { 'Content-Type': 'application/json' } });
    
    tokens.push(JSON.parse(login.body).accessToken);
  }
  return { tokens };
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const res = http.post('http://localhost:3000/api/orders/checkout', JSON.stringify({
    shippingAddress: { name: 'K6', street: 'Calle', city: 'Bogotá', country: 'CO', phone: '123' },
  }), {
    headers: { 
      'Content-Type': 'application/json', 
      Authorization: `Bearer ${token}`, 
      'Idempotency-Key': `k6-${__VU}-${__ITER}` 
    },
    tags: { endpoint: 'checkout' },
  });
  check(res, { 'checkout 2xx/4xx': (r) => [200, 201, 400, 409].includes(r.status) });
}
___________________________________________________________
Paso 10.5: Seguridad (OWASP ZAP)

.github/workflows/security.yml
___________________________________________________________
name: Security Scan
on:
  schedule: [{ cron: '0 3 * * 1' }] # Lunes a las 3 AM
  workflow_dispatch:
jobs:
  zap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: ZAP Baseline Scan
        uses: zaproxy/action-baseline@v0.10.0
        with:
          target: ${{ secrets.STAGING_URL }}
          rules_file_name: '.zap/rules.tsv'
          fail_action: true
___________________________________________________________
.zap/rules.tsv
___________________________________________________________
10038	IGNORE	(Content Security Policy Header Not Set - handled by Helmet)
___________________________________________________________
Paso 10.6: Documentación Profunda

docs/adr/001-mongodb-vs-postgres.md
___________________________________________________________
# ADR 001 — MongoDB vs PostgreSQL

## Contexto
e_commerce_01 maneja catálogo, carrito y órdenes con esquemas que evolucionan rápido.

## Decisión
MongoDB 7 con replica set.

## Alternativas consideradas
- PostgreSQL + Prisma: transacciones más maduras, pero esquema rígido para catálogo.

## Consecuencias
- Transacciones requieren replica set en todos los entornos.
- Idempotencia y concurrencia se resuelven con índices únicos + `findOneAndUpdate`.
___________________________________________________________
(Se deben crear 4 ADRs más: 002-jwt-refresh, 003-stripe-vs-paypal, 004-monorepo, 005-redis-cache).

README.md (Estructura)
___________________________________________________________
# e_commerce_01
Stack: React, Express, MongoDB, Redis, Stripe.
## Quick Start
1. `docker compose -f docker-compose.dev.yml up -d`
2. `cd server && npm ci && npm run dev`
3. `cd client && npm ci && npm run dev`
## Comandos
- `npm test` (Backend tests)
- `npm run test:e2e` (Frontend E2E)
- `npm run backup` (Backup a S3)
___________________________________________________________
CONTRIBUTING.md (Estructura)
___________________________________________________________
# Contribuir
1. Crear rama: `feat/mi-feature`
2. Commits: `feat: add new feature` (Conventional Commits)
3. PR: Requiere tests y typecheck verde.
___________________________________________________________
Paso 10.7: CI con E2E

Actualizar .github/workflows/ci.yml (Añadir job)
___________________________________________________________
  e2e:
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7
        options: --health-cmd "mongosh --eval 'db.runCommand({ping:1})'" --health-interval 10s --health-retries 5
        ports: ["27017:27017"]
      redis:
        image: redis:7
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Init replica set
        run: |
          mongosh --host localhost:27017 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
          sleep 3
      - run: cd server && npm ci && npm run build
      - name: Start Backend
        run: |
          cd server
          npm start &
          sleep 5
        env:
          MONGODB_URI: mongodb://localhost:27017/e_commerce_01_test?replicaSet=rs0
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-at-least-32-chars-long-1234
          COOKIE_SECRET: test-cookie
          DISABLE_2FA_IN_TEST: 'true'
          NODE_ENV: test
      - run: cd client && npm ci && npm run build
      - run: cd client && npx playwright install --with-deps chromium
      - run: cd client && npm run test:e2e
        env:
          BASE_URL: http://localhost:5173
___________________________________________________________
🚦 4. Gate 10 (Validación)

No des por terminado el proyecto hasta que se cumplan TODOS estos puntos:

□ PostHog Consent-Gated: Abrir la app en incógnito. Verificar en DevTools (Network) que las peticiones a PostHog NO se hacen. Hacer clic en "Aceptar todo". Navegar y verificar que ahora sí se envían eventos.
□ Playwright: Ejecutar npx playwright test en el cliente. Los tests de compra (Stripe redirect) y admin 2FA (generación TOTP) deben pasar en verde. Los reportes en HTML deben generarse.
□ k6 Load Test: Ejecutar k6 run k6/load-test.js. Verificar que el p95 de /products está por debajo de 500ms. Ejecutar k6 run k6/checkout-test.js y verificar que el p95 de checkout es < 1000ms.
□ ZAP: Ejecutar el workflow de ZAP manualmente desde GitHub Actions. Revisar el reporte: no debe haber alertas de nivel "High".
□ ADRs y Documentación: Verificar que los 5 ADRs existen, que el README.md te permite levantar el proyecto en menos de 5 minutos, y que el RUNBOOK.md tiene los 5 incidentes documentados.
□ Onboarding: (Simulación) Pasarle el README a alguien que no conozca el proyecto. Debería poder levantar el entorno, correr los tests y entender la arquitectura sin ayuda.
___________________________________________________________
