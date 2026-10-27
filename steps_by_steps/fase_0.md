# Fase 0 Granular:
* Configuración del Entorno y Estructura del Proyecto

Esta fase es la más importante a nivel de cimientos. Un error aquí se paga caro en fases posteriores. Vamos paso a paso, con comandos exactos, código y la justificación de cada decisión.

# 0.1 Prerrequisitos:
Verificar el Entorno Local

Antes de crear una sola carpeta, verificamos las versiones instaladas. La consistencia en las versiones evita el clásico "en mi máquina funciona".

# Paso 0.1.1:
Verificar versiones

Abre una terminal y ejecuta:

node -v
npm -v
git --version

# Versiones recomendadas para este proyecto:

Herramienta	 Versión mínima	Versión recomendada
* Node.js	18.x (LTS)	20.x (LTS activo)
* npm	9.x	10.x
* Git	2.30+	Última estable

⚠️ Nota crítica: 
Si tienes Node 16 o inferior, actualiza.
React 18 y muchas dependencias modernas del ecosistema requieren Node 18+. Usa nvm (Linux/Mac) o nvm-windows para gestionar múltiples versiones.

# Paso 0.1.2: 
Instalar nvm y fijar versión (opcional pero recomendado)

# Linux/Mac
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Luego, dentro de la carpeta del proyecto (lo haremos más adelante):
nvm install 20
nvm use 20
echo "20" > .nvmrc

Esto garantiza que todo el equipo (o tú en otra máquina) use la misma versión.

0.2 Crear la Estructura Raíz del Proyecto

# Paso 0.2.1:
Crear la carpeta raíz e inicializar Git

bash
mkdir e_commerce_01
cd e_commerce_01
git init

¿Por qué Git desde el inicio? Porque cada paso que hagamos será un commit atómico y descriptivo. Facilita revertir cambios y auditar la evolución.

# Paso 0.2.2: Crear la estructura base de carpetas

bash
mkdir client server

Decisión arquitectónica: Optamos por dos proyectos separados (client/ y server/) en lugar de un monorepo con workspaces.

# Razones:

Criterio	Carpetas separadas (elegido)	Monorepo con workspaces

Simplicidad inicial	✅ Alta	❌ Media (requiere configurar workspaces)

Despliegue independiente	✅ Natural	⚠️ 
Requiere configuración extra

Curva de aprendizaje	✅ Baja	❌ Media

Escalabilidad a equipos grandes	⚠️ Media	✅ Alta

💡 Para un equipo de 1-3 desarrolladores y despliegues separados (Vercel + Render), carpetas separadas es la opción pragmática. Si el proyecto crece, migrar a monorepo es un refactor posterior.

# Paso 0.2.3: Crear el .gitignore raíz

bash
touch .gitignore
Contenido de e_commerce_01/.gitignore:

gitignore
# Dependencias
node_modules/
*/node_modules/

# Variables de entorno (NUNCA subir al repo)
.env
.env.local
.env.*.local
!.env.example

# Builds
client/dist/
client/build/
server/dist/

# Logs
*.log
npm-debug.log*
logs/

# Sistema operativo
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp

# Coverage
coverage/
🔐 Regla de oro: Los archivos .env jamás se commitean. Solo se commitea .env.example (plantilla sin valores reales). Esto es un RNF de seguridad (RNF-02).

# Paso 0.2.4: Primer commit

bash
git add .gitignore
git commit -m "chore: init repo with base folder structure"

🔧 0.3 Configuración del Backend (server/)

# Paso 0.3.1: Inicializar el proyecto Node.js

bash
cd server
npm init -y
Esto genera un package.json con valores por defecto. Vamos a editarlo para que sea profesional.

# Paso 0.3.2: Editar server/package.json

Reemplaza el contenido generado por este:

json
{
  "name": "e_commerce_01-server",
  "version": "0.1.0",
  "description": "API RESTful para la plataforma Ecommerce e_commerce_01",
  "main": "index.js",
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "test": "node --test"
  },
  "keywords": ["ecommerce", "api", "express", "nodejs"],
  "author": "",
  "license": "MIT"
}

Decisiones clave explicadas:

Campo	Valor	¿Por qué?
"main"	src/server.js	Todo el código fuente vive en src/. server.js es el punto de entrada.

"type"	"module"	Habilita ES Modules (import/export) en lugar de CommonJS (require). Es el estándar moderno y alineado con el frontend.

"engines"	>=18.0.0	Fuerza versiones compatibles. Si alguien corre con Node 16, npm install falla con advertencia.

"dev"	node --watch src/server.js	--watch (Node 18.11+) reinicia el servidor al guardar cambios, sin dependencias extra como nodemon o ts-node-dev. Menos dependencias = menos superficie de ataque.

💡 Alternativa: Podrías usar nodemon. Pero --watch nativo de Node cumple la misma función sin instalar nada. Lo preferimos por minimalismo.

# Paso 0.3.3: Instalar dependencias de producción

bash
npm install express mongoose dotenv cors helmet bcryptjs jsonwebtoken express-rate-limit

Justificación de cada una:

Dependencia	/ Propósito en el proyecto / Fase que la usa

express	Framework HTTP minimalista para construir la API REST.	
Fase 1 en adelante

mongoose	ODM para MongoDB. Define esquemas y valida datos.	
Fase 1 (Modelos)

dotenv	Carga variables desde .env a process.env.	Fase 0 (ahora)

cors	Permite que el frontend (localhost:5173) consuma la API (localhost:3000).	Fase 0 (ahora)

helmet	Añade cabeceras HTTP de seguridad (CSP, X-Frame-Options, etc.). Mitiga XSS y clickjacking.	Fase 0 (ahora)

bcryptjs	Hash de contraseñas. bcrypt nativo requiere compilación; bcryptjs es puro JS.	Fase 1 (Auth)

jsonwebtoken	Generación y verificación de JWT para sesiones.	Fase 1 (Auth)

express-rate-limit	Limita peticiones por IP. Mitiga ataques de fuerza bruta y DoS.	Fase 0 (ahora)

# Paso 0.3.4: Instalar dependencias de desarrollo

bash
npm install --save-dev dotenv-cli
⚠️ Nota: Actualmente necesitamos pocas devDependencies en backend. Añadiremos jest, supertest en la Fase 5 (Testing). dotenv-cli permite cargar .env en scripts (útil para tests con .env.test).
Verifica el package.json resultante:

bash
cat package.json
Deberías ver los bloques dependencies y devDependencies poblados.

# Paso 0.3.5: Crear la estructura de carpetas del backend

bash
mkdir -p src/{config,models,controllers,routes,middlewares,services,utils}
touch src/server.js src/app.js
touch src/config/database.js
touch .env .env.example

Estructura resultante:

text
server/
├── src/
│   ├── config/          # Configuración (conexión DB, constantes)
│   │   └── database.js
│   ├── controllers/     # Manejan req/res (Fase 1+)
│   ├── middlewares/     # Auth, validación, error handler (Fase 1+)
│   ├── models/          # Esquemas Mongoose (Fase 1)
│   ├── routes/          # Definición de endpoints (Fase 1+)
│   ├── services/        # Lógica de negocio pura (Fase 2)
│   ├── utils/           # Helpers (JWT, formateo, etc.)
│   ├── app.js           # Configura Express (middlewares, rutas)
│   └── server.js        # Punto de entrada: arranca el servidor
├── .env
├── .env.example
└── package.json
¿Por qué separar app.js y server.js?

app.js exporta la app de Express configurada (sin escuchar en un puerto).

server.js importa app y hace app.listen(PORT).

Beneficio: En Fase 5, los tests con supertest importan app directamente sin levantar un servidor real. Esto hace los tests más rápidos y aislados.

# Paso 0.3.6: Configurar .env.example y .env

server/.env.example (esta SÍ se commitea — es la plantilla):


env
# ─── Servidor ─────────────────────────────────────────────
NODE_ENV=development
PORT=3000

# ─── Base de Datos ────────────────────────────────────────
# Local: mongodb://127.0.0.1:27017/e_commerce_01
# Atlas: mongodb+srv://<user>:<pass>@cluster.mongodb.net/e_commerce_01
MONGODB_URI=mongodb://127.0.0.1:27017/e_commerce_01

# ─── JWT ──────────────────────────────────────────────────
JWT_SECRET=change_this_in_production_min_32_chars
JWT_EXPIRES_IN=1h

# ─── CORS ─────────────────────────────────────────────────
CLIENT_ORIGIN=http://localhost:5173

# ─── Rate Limiting ────────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

server/.env (NO se commitea — copia el ejemplo y ajusta):

bash
cp .env.example .env
Edita .env y pon un JWT_SECRET real. Genera uno seguro:

bash
# Linux/Mac
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# O con openssl
openssl rand -hex 48
🔐 Pega ese valor en JWT_SECRET de tu .env. Guárdalo en un gestor de contraseñas, porque cambiarlo invalida todos los JWT existentes (los usuarios tendrían que volver a loguearse).

# Paso 0.3.7: Crear src/config/database.js

javascript
// server/src/config/database.js
import mongoose from 'mongoose';

/**
 * Establece la conexión con MongoDB.
 * Se llama una sola vez desde server.js al arrancar.
 */
export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI no está definida en las variables de entorno');
  }

  try {
    const conn = await mongoose.connect(uri, {
      // Opciones recomendadas para producción
      serverSelectionTimeoutMS: 5000, // Falla rápido si no hay conexión
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB conectado: ${conn.connection.host}/${conn.connection.name}`);

    // Event listeners para monitoreo
    mongoose.connection.on('error', (err) => {
      console.error('❌ Error de MongoDB:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB desconectado');
    });

    return conn;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    throw error; // Re-lanzamos para que server.js decida qué hacer
  }
}
# Paso 0.3.8: Crear src/app.js (Express configurado, sin listen)

javascript
// server/src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// ─── Middlewares de Seguridad ────────────────────────────
app.use(helmet()); // Cabeceras de seguridad HTTP

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true, // Permite cookies/httpOnly si se usan en el futuro
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Rate Limiting ────────────────────────────────────────
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: Number(process.env.RATE_LIMIT_MAX) || 100, // 100 req por ventana
  standardHeaders: true, // Envía headers RateLimit-* (RFC 6585)
  legacyHeaders: false, // Desactiva X-RateLimit-* (obsoletos)
  message: {
    status: 429,
    message: 'Demasiadas peticiones. Intenta más tarde.',
  },
});
app.use('/api', limiter); // Aplica solo a rutas de la API

// ─── Parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // Previene payloads gigantes
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── Health Check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── Rutas de la API (se irán agregando en fases siguientes) ──
// app.use('/api/auth', authRoutes);
// app.use('/api/products', productRoutes);
// app.use('/api/cart', cartRoutes);
// app.use('/api/orders', orderRoutes);

// ─── 404 Handler (rutas no encontradas) ───────────────────
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// ─── Error Handler Global ─────────────────────────────────
// Debe ir al final, DESPUÉS de todas las rutas
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message;

  console.error(`❌ [${req.method} ${req.originalUrl}]`, err.stack);

  res.status(statusCode).json({
    status: 'error',
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

export default app;
Decisiones explicadas:

Middleware / Config	Propósito
helmet()	Añade ~11 cabeceras HTTP de seguridad. Imprescindible en producción.
cors({ origin, credentials })	Restringe qué orígenes pueden llamar la API. credentials: true prepara el terreno para cookies httpOnly (más seguro que localStorage para JWT).
rateLimit aplicado a /api	No aplica a /health (para que el load balancer no consuma cuota).
express.json({ limit: '10kb' })	Previene ataques de payload gigante (DoS por memoria).
404 handler	Devuelve JSON consistente, no HTML por defecto de Express.
Error handler global	Centraliza el manejo de errores. En producción oculta el stack (no filtra info interna).

# Paso 0.3.9: Crear src/server.js (Punto de entrada)

javascript
// server/src/server.js
import 'dotenv/config'; // Carga .env ANTES de cualquier otro import
import app from './app.js';
import { connectDatabase } from './config/database.js';

const PORT = Number(process.env.PORT) || 3000;

/**
 * Arranca la aplicación: primero conecta a la BD, luego escucha.
 * Si la BD falla, el proceso muere con código != 0 (bueno para orquestadores como Docker/K8s).
 */
async function bootstrap() {
  try {
    await connectDatabase();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`❤️  Health check: http://localhost:${PORT}/health`);
    });

    // ─── Graceful Shutdown ─────────────────────────────────
    // Cuando el proceso recibe SIGTERM (Docker, K8s, Heroku), cerramos ordenadamente.
    const shutdown = (signal) => {
      console.log(`\n${signal} recibido. Cerrando servidor...`);
      server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        process.exit(0);
      });

      // Fuerza cierre si tarda más de 10s
      setTimeout(() => {
        console.error('⏱️  Timeout. Forzando salida.');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Falla al arrancar el servidor:', error.message);
    process.exit(1);
  }
}

bootstrap();
💡 Por qué import 'dotenv/config' como primer import: En ES Modules, los imports se ejecutan antes del cuerpo del módulo. Al poner dotenv/config de primero, garantizamos que process.env ya tenga los valores cuando app.js y database.js se importen (y lean process.env.CLIENT_ORIGIN, etc.).

# Paso 0.3.10: Configurar MongoDB local (si no lo tienes)

Opción A — MongoDB Atlas (recomendado, 0 instalación):

Crea cuenta gratis en mongodb.com/atlas.
Crea un cluster M0 (gratis).
Crea usuario de BD y permite tu IP.
Copia el connection string y pégalo en MONGODB_URI de tu .env:

text
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/e_commerce_01?retryWrites=true&w=majority
Opción B — MongoDB local con Docker:

bash
docker run -d \
  --name e_commerce_01-mongo \
  -p 27017:27017 \
  -v e_commerce_01-mongo-data:/data/db \
  mongo:7
Tu .env con MONGODB_URI=mongodb://127.0.0.1:27017/e_commerce_01 funciona directamente.

Opción C — MongoDB instalado nativo: Descarga desde mongodb.com/try/download/community.

# Paso 0.3.11: Verificar que el backend arranca

bash
npm run dev
Salida esperada:

text
✅ MongoDB conectado: cluster0.xxxxx.mongodb.net/e_commerce_01
🚀 Servidor corriendo en http://localhost:3000
🌍 Entorno: development
❤️  Health check: http://localhost:3000/health
Prueba el health check:

bash
# En otra terminal
curl http://localhost:3000/health
Respuesta esperada:

json
{
  "status": "ok",
  "uptime": 5.234,
  "timestamp": "2026-10-21T14:30:00.000Z",
  "environment": "development"
}
Prueba también la 404:

bash
curl http://localhost:3000/no-existe
Deberías ver:

json
{
  "status": "error",
  "message": "Ruta no encontrada: GET /no-existe"
}
✅ Checklist de validación backend:

□ npm run dev arranca sin errores.
□ /health responde 200 con JSON.
□ Ruta inexistente devuelve 404 en JSON (no HTML).
□ MongoDB aparece conectado en los logs.
□ Al guardar un archivo, el servidor se reinicia (gracias a --watch).
# Paso 0.3.12: Commit del backend

bash
cd ..
git add server/
git commit -m "feat(server): initial Express setup with security middlewares

- Express app with helmet, cors, rate-limit
- MongoDB connection via Mongoose
- Global error handler and 404 handler
- Health check endpoint
- Graceful shutdown on SIGTERM/SIGINT"
🔍 git add server/ NO incluirá server/.env ni server/node_modules/ gracias al .gitignore. Si quieres verificar:

bash
git status
No debe aparecer ni .env ni node_modules/.
⚛️ 0.4 Configuración del Frontend (client/)

# Paso 0.4.1: Crear el proyecto React con Vite

bash
npm create vite@latest client -- --template react
Cuando pregunte si crear la carpeta aunque no esté vacía, si la carpeta client/ ya existe vacía, responde que sí. Luego:

bash
cd client
npm install
¿Por qué Vite y no Create React App (CRA)?

Criterio	Vite (elegido)	CRA (obsoleto)
Velocidad de arranque	⚡ ~300ms	🐢 ~10-30s
HMR (Hot Module Replacement)	Instantáneo	Lento
Estado del proyecto	✅ Activamente mantenido	⚠️ Deprecado desde 2023
Build de producción	Rollup (rápido)	Webpack (lento)
✅ Vite es el estándar actual para nuevos proyectos React.

# Paso 0.4.2: Instalar dependencias adicionales del frontend

bash
npm install react-router-dom axios
Justificación:

Dependencia	Propósito	Fase
react-router-dom	Enrutamiento SPA (/, /cart, /checkout, etc.).	Fase 3
axios	Cliente HTTP con interceptores (para adjuntar JWT automáticamente).	Fase 4
💡 Añadiremos jest, @testing-library/react en la Fase 5. Por ahora, mantenemos el package.json limpio.

# Paso 0.4.3: Limpiar el boilerplate de Vite

Vite genera código de ejemplo que no necesitamos. Vamos a limpiarlo.

Elimina estos archivos:

bash
rm src/App.css src/assets/react.svg public/vite.svg
Reemplaza src/App.jsx por:

jsx
function App() {
  return (
    <div>
      <h1>🛒 e_commerce_01</h1>
      <p>Frontend en construcción (Fase 0 completada).</p>
    </div>
  );
}

export default App;
Reemplaza src/index.css por:

css
/* Reset básico — ampliaremos en Fase 3 con sistema de diseño */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#root {
  height: 100%;
}

body {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
Reemplaza src/main.jsx por:

jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
💡 React.StrictMode en desarrollo monta dos veces los componentes para detectar efectos secundarios impuros. Es una red de seguridad; no afecta a producción.
Edita index.html para el título:

html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="e_commerce_01 - Tienda de tecnología online" />
    <title>e_commerce_01</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
Si borraste public/vite.svg pero dejaste la referencia en el <link rel="icon">, el navegador mostrará un 404. O creas un favicon.svg propio, o eliminas esa línea. Elimínala por ahora (o copia uno genérico).

# Paso 0.4.4: Crear estructura de carpetas del frontend

bash
mkdir -p src/{components,pages,context,hooks,services,utils,assets}
touch src/services/api.js
Estructura resultante:

text
client/
├── public/
├── src/
│   ├── assets/          # Imágenes, fuentes, iconos
│   ├── components/      # Componentes reutilizables (ProductCard, Button, etc.)
│   ├── context/         # Context API (CartContext, AuthContext)
│   ├── hooks/           # Custom hooks (useCart, useAuth)
│   ├── pages/           # Vistas por ruta (HomePage, CartPage, CheckoutPage)
│   ├── services/        # Cliente HTTP (api.js)
│   ├── utils/           # Helpers (formatters, validators)
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── index.html
├── package.json
└── vite.config.js

# Paso 0.4.5: Configurar vite.config.js con proxy (clave para desarrollo)

Reemplaza vite.config.js:

javascript
// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Cualquier petición a /api/* se reenvía al backend
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
¿Por qué el proxy? Sin él, tendrías que escribir http://localhost:3000/api/products en cada llamada. Con el proxy, escribes /api/products y Vite lo reenvía al backend. Beneficios:

Evita problemas de CORS en desarrollo (aunque igual configuramos cors en el backend para el caso de producción).
Código portable: En producción, /api/products apunta al mismo dominio (ej. e_commerce_01.com/api/products). Mismas URLs en dev y prod.
Simplifica los axios interceptores (Fase 4).

# Paso 0.4.6: Crear el cliente HTTP base src/services/api.js

javascript
// client/src/services/api.js
import axios from 'axios';

/**
 * Instancia de Axios preconfigurada.
 * - baseURL '/api' aprovecha el proxy de Vite en dev.
 * - Interceptores añadirán JWT y manejarán errores globalmente (Fase 4).
 */
const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
💡 En Fase 4 añadiremos un request interceptor para adjuntar Authorization: Bearer <token> y un response interceptor para manejar 401 (token expirado → redirigir a login).
# Paso 0.4.7: Verificar que el frontend arranca

bash
npm run dev
Abre http://localhost:5173. Deberías ver:

text
🛒 e_commerce_01
Frontend en construcción (Fase 0 completada).
# Paso 0.4.8: Verificar la comunicación frontend ↔ backend

Con ambos servidores corriendo (backend en :3000, frontend en :5173), abre la consola del navegador en http://localhost:5173 y ejecuta:

javascript
fetch('/api/health')
  .then(r => r.json())
  .then(console.log);
⚠️ Ojo: /health en el backend no está bajo /api (lo pusimos en la raíz para que el load balancer lo consulte sin rate-limit). Así que la prueba correcta es:

javascript
fetch('/health').then(r => r.json()).then(console.log);
Pero como el proxy de Vite solo redirige /api/*, /health fallará. Es correcto. En Fase 4, cuando añadamos rutas bajo /api, el proxy funcionará. Si quieres probar ahora, puedes añadir al proxy:

javascript
'/health': { target: 'http://localhost:3000', changeOrigin: true }
O simplemente verificar el proxy con una ruta /api/ que devuelva 404 del backend (no del Vite dev server):

javascript
fetch('/api/anything').then(r => r.json()).then(console.log);
Deberías ver { status: 'error', message: 'Ruta no encontrada: GET /api/anything' }, lo que confirma que el proxy reenvía al backend.
✅ Checklist de validación frontend:

□ npm run dev arranca sin errores.
□ http://localhost:5173 muestra "e_commerce_01".
□ fetch('/api/anything') en consola devuelve el 404 del backend (no del dev server de Vite).
□ El HMR funciona (edita App.jsx y ve el cambio sin recargar).

# Paso 0.4.9: Commit del frontend

bash
cd ..
git add client/
git commit -m "feat(client): initial React setup with Vite

- Vite + React 18 with react-router-dom and axios
- Folder structure: components, pages, context, hooks, services
- Vite proxy to backend for /api routes
- Base axios client preconfigured"
📖 0.5 Documentación Inicial del Proyecto

# Paso 0.5.1: Crear el README.md raíz

bash
touch README.md
markdown
# 🛒 e_commerce_01

Plataforma Ecommerce completa construida con **React** (frontend) y **Node.js/Express** (backend).

## Stack

| Capa | Tecnología |
| :--- | :--- |
| Frontend | React 18 + Vite + React Router + Axios |
| Backend | Node.js 20 + Express + Mongoose |
| Base de datos | MongoDB (Atlas o local) |
| Auth | JWT + bcryptjs |

## Estructura
e_commerce_01/
├── client/ # Frontend React (Vite)
└── server/ # Backend API REST (Express)

text

## Requisitos previos

- Node.js >= 18
- npm >= 9
- MongoDB (local o Atlas)
- Git

## Instalación

```bash
# 1. Clonar
git clone <repo-url>
cd e_commerce_01

# 2. Backend
cd server
npm install
cp .env.example .env
# Edita .env con tu MONGODB_URI y JWT_SECRET
npm run dev

# 3. Frontend (en otra terminal)
cd client
npm install
npm run dev
URLs de desarrollo

Frontend: http://localhost:5173
Backend API: http://localhost:3000
Health check: http://localhost:3000/health
Roadmap

☑ Fase 0: Setup del entorno y estructura
□ Fase 1: Modelos y autenticación (JWT)
□ Fase 2: Carrito y checkout transaccional
□ Fase 3: UI y Context API
□ Fase 4: Conexión frontend ↔ backend
□ Fase 5: Testing y despliegue CI/CD

text

# Paso 0.5.2: Crear `.nvmrc` (opcional, pero muy útil en equipo)

```bash
echo "20" > .nvmrc
Con esto, cualquiera que entre al proyecto y tenga nvm ejecuta nvm use y obtiene la versión correcta.

# Paso 0.5.3: Commit final de documentación

bash
git add README.md .nvmrc
git commit -m "docs: add README with setup instructions and roadmap"
✅ 0.6 Checklist Final de la Fase 0

Antes de pasar a la Fase 1, verifica todo esto:

Backend

□ cd server && npm run dev arranca sin errores.
□ MongoDB conecta correctamente (log ✅ MongoDB conectado).
□ curl http://localhost:3000/health devuelve JSON 200.
□ curl http://localhost:3000/no-existe devuelve JSON 404.
□ .env no está en Git (git status no lo muestra).
□ node_modules/ no está en Git.
□ El servidor se reinicia al guardar un archivo.
□ Ctrl+C cierra limpiamente (gracias a SIGINT handler).

Frontend

□ cd client && npm run dev arranca en :5173.
□ La página muestra "🛒 e_commerce_01".
□ fetch('/api/anything') en consola devuelve el 404 del backend.
□ HMR funciona al editar App.jsx.

Proyecto

□ git log --oneline muestra 4 commits limpios.
□ git status está limpio (nada pendiente).
□ El README.md describe cómo levantar el proyecto.
□ La estructura de carpetas coincide con la documentada.
🎯 Resumen Visual de la Fase 0

text
┌──────────────────────────────────────────────────────────┐
│                    PROYECTO e_commerce_01                    │
├──────────────────────────┬───────────────────────────────┤
│   client/  (React+Vite)  │   server/  (Node+Express)     │
│   :5173                  │   :3000                       │
│                          │                               │
│   ┌──────────────┐       │   ┌──────────────┐            │
│   │  App.jsx     │───────┼──▶│  server.js   │            │
│   │  main.jsx    │ proxy │   │  app.js      │            │
│   └──────────────┘       │   └──────┬───────┘            │
│                          │          │                    │
│   src/services/api.js ───┼──▶ /api/*│                    │
│                          │          ▼                    │
│                          │   ┌──────────────┐            │
│                          │   │  MongoDB     │            │
│                          │   │  e_commerce_01   │            │
│                          │   └──────────────┘            │
└──────────────────────────┴───────────────────────────────┘