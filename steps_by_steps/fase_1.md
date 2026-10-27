Fase 1 Granular: Modelos y Autenticación (JWT)

Esta fase construye el módulo de identidad del sistema: registro, login, sesión persistente y autorización por roles. Es la base sobre la que se apoyan el carrito, el checkout y el panel admin.

Lo que construiremos:

Modelo User con Mongoose (hash automático de password con bcryptjs).
Servicio de autenticación (registerUser, loginUser).
Endpoints POST /api/auth/register, POST /api/auth/login, GET /api/auth/me.
Middlewares protect (verifica JWT) y admin (autorización por rol).
Validación con express-validator.
Frontend: AuthContext, hook useAuth, páginas Login y Register, ProtectedRoute.
Pruebas con curl y checklist.

📋 1.1 Prerrequisitos: Dependencias Adicionales

La Fase 0 ya instaló bcryptjs y jsonwebtoken. Solo falta express-validator para validación declarativa.

bash
cd server
npm install express-validator
¿Por qué express-validator y no zod/joi?

Criterio	express-validator (elegido)	zod	joi
Integración con Express	✅ Nativa (body(), param(), query())	⚠️ Requiere middleware custom	⚠️ Requiere middleware custom
Curva de aprendizaje	✅ Baja	❌ Media	❌ Media
Verbosidad	✅ Concisa en rutas	✅ Concisa	❌ Verbosa
Verifica que jsonwebtoken y bcryptjs estén instalados:

bash
npm ls jsonwebtoken bcryptjs
Si por alguna razón no aparecen:

bash
npm install bcryptjs jsonwebtoken
🧰 1.2 Utilidades Base

# Paso 1.2.1: Clase AppError (server/src/utils/AppError.js)

Todos los errores controlados del negocio (Email ya registrado, Credenciales inválidas) usarán esta clase. Así el error handler global distingue entre errores esperados (devuelven statusCode correcto: 401, 409, etc.) y errores inesperados (500).

javascript
// server/src/utils/AppError.js

/**
 * Error de aplicación con statusCode HTTP.
 * Extiende Error para que el stack trace sea útil.
 *
 * @example
 *   throw new AppError('Email ya registrado', 409);
 */
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Diferencia de errores inesperados (bugs)
    Error.captureStackTrace(this, this.constructor);
  }
}
💡 isOperational: true marca el error como "esperado por el negocio". Útil si en el futuro se integra un sistema de logging (ej. Sentry) para no alertar por errores 4xx (errores del usuario, no del servidor).
# Paso 1.2.2: Utilidades JWT (server/src/utils/jwt.js)

Centraliza firma y verificación. Si mañana cambiamos el algoritmo o el payload, se toca un solo archivo.

javascript
// server/src/utils/jwt.js
import jwt from 'jsonwebtoken';
import { AppError } from './AppError.js';

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

if (!SECRET) {
  // Falla al importar, no en cada request
  throw new Error('JWT_SECRET no está definido en las variables de entorno');
}

if (SECRET.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres (RNF-02)');
}

/**
 * Firma un token con el id y role del usuario.
 * @param {{ id: string, role: string }} payload
 * @returns {string} JWT firmado
 */
export function signToken({ id, role }) {
  return jwt.sign({ id, role }, SECRET, {
    expiresIn: EXPIRES_IN,
    issuer: 'e_commerce_01-api',
  });
}

/**
 * Verifica un token y devuelve el payload decodificado.
 * Lanza error si es inválido o expiró (lo maneja el middleware).
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET, { issuer: 'e_commerce_01-api' });
  } catch (err) {
    // Re-lanzamos con nuestro AppError para manejo consistente
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Token expirado', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AppError('Token inválido', 401);
    }
    throw err;
  }
}
Decisiones explicadas:

Detalle	Justificación
Validación de SECRET al importar	Fail-fast: si falta la variable, el servidor no arranca (mejor que fallar en el primer login).
SECRET.length < 32	Un secreto corto es vulnerable a fuerza bruta. 32+ chars hex = 256 bits de entropía.
issuer: 'e_commerce_01-api'	Previene el "token confusion attack": tokens de otras apps (con el mismo secret compartido por error) no son aceptados.
Payload mínimo (id, role)	Menos datos en el token = menos exposición si se filtra. No incluir el email ni el nombre.
Re-lanzar como AppError	El middleware protect se simplifica: solo captura AppError.
👤 1.3 Modelo User

# Paso 1.3.1: Crear el modelo (server/src/models/User.js)

javascript
// server/src/models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12; // Costo 2^12 ≈ 250ms por hash en hardware moderno

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      minlength: [2, 'El nombre debe tener al menos 2 caracteres'],
      maxlength: [50, 'El nombre no puede exceder 50 caracteres'],
    },
    email: {
      type: String,
      required: [true, 'El email es obligatorio'],
      unique: true, // Crea índice único automáticamente
      lowercase: true, // Normaliza antes de guardar
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email inválido'],
    },
    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: [8, 'La contraseña debe tener al menos 8 caracteres'],
      select: false, // 🔐 NO se devuelve por defecto en queries
    },
    role: {
      type: String,
      enum: {
        values: ['user', 'admin'],
        message: 'Rol inválido: {VALUE}',
      },
      default: 'user',
    },
  },
  {
    timestamps: true, // Añade createdAt y updatedAt
  }
);

// ─── Hashing automático antes de guardar ──────────────────
userSchema.pre('save', async function (next) {
  // Solo hashea si el password fue creado o modificado
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Método de instancia para comparar passwords ──────────
userSchema.methods.comparePassword = function (candidatePassword) {
  // bcrypt.compare es constant-time: previene timing attacks
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── toJSON: nunca exponer password al serializar ─────────
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;
Decisiones críticas explicadas:

Línea / Config	Por qué es importante
select: false en password	Cualquier User.find() no devuelve el hash. Solo queries explícitas con .select('+password') lo obtienen.
lowercase: true en email	Evita duplicados tipo User@x.com vs user@x.com.
unique: true en email	MongoDB rechaza duplicados a nivel DB (defensa en profundidad, además de la validación en servicio).
pre('save') con isModified	Si actualizas solo el name, no re-hashea el password (evitaría rehash del hash).
BCRYPT_ROUNDS = 12	Balance seguridad/rendimiento. 10 es el mínimo aceptable hoy; 12 es el recomendado para apps nuevas (2026). No bajar de 10.
toJSON transform	Doble red de seguridad: incluso si alguien hace res.json(user) con el password seleccionado, se elimina antes de enviarlo.
Error.captureStackTrace	Ya visto en AppError, pero el patrón se mantiene consistente.
⚠️ Anti-patrón común: Muchos tutoriales usan bcrypt.hash(password, 10) sin genSalt() separado. Funciona, pero generar salt explícito permite ajustar el costo después sin cambiar el algoritmo. Ambos válidos; el elegido es ligeramente más explícito.
# Paso 1.3.2: Verificar que el modelo carga

bash
cd server
node -e "import('./src/models/User.js').then(() => console.log('✅ Modelo User carga correctamente'))"
Deberías ver:

text
✅ Modelo User carga correctamente
Si falla, revisa que JWT_SECRET esté definido en .env (el modelo no lo usa, pero server.js sí lo valida al importar).

🔐 1.4 Servicio de Autenticación

El servicio contiene la lógica pura del negocio. No sabe de HTTP (req, res). Esto permite reutilizarlo desde un script, un test, o un job programado.

# Paso 1.4.1: Crear el servicio (server/src/services/auth.service.js)

javascript
// server/src/services/auth.service.js
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { signToken } from '../utils/jwt.js';

/**
 * Registra un usuario nuevo.
 * @param {{ name: string, email: string, password: string }} data
 * @returns {{ user: object, token: string }}
 * @throws {AppError} 409 si el email ya existe
 */
export async function registerUser({ name, email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  // Verificamos duplicado ANTES de crear (mejor UX que capturar el error de Mongo)
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new AppError('El email ya está registrado', 409);
  }

  const user = await User.create({ name, email: normalizedEmail, password });

  const token = signToken({ id: user._id.toString(), role: user.role });

  return { user, token };
}

/**
 * Autentica un usuario con email y password.
 * @param {{ email: string, password: string }} credentials
 * @returns {{ user: object, token: string }}
 * @throws {AppError} 401 si las credenciales son inválidas
 */
export async function loginUser({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  // .select('+password') porque el schema tiene select:false por defecto
  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  // 🔐 CRÍTICO: mismo error si el usuario no existe o si el password es incorrecto.
  //    Previene "user enumeration attack" (atacante no sabe qué emails existen).
  if (!user) {
    throw new AppError('Credenciales inválidas', 401);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Credenciales inválidas', 401);
  }

  const token = signToken({ id: user._id.toString(), role: user.role });

  // Re-fetch sin password para que la respuesta no lo incluya
  user.password = undefined;

  return { user, token };
}

/**
 * Obtiene el usuario autenticado por su id.
 * Usado por GET /api/auth/me.
 */
export async function getUserById(id) {
  const user = await User.findById(id);
  if (!user) {
    throw new AppError('Usuario no encontrado', 404);
  }
  return user;
}
Decisiones clave:

Detalle	Justificación
email.toLowerCase().trim() en ambos métodos	Normalización defensiva. El schema ya lo hace, pero evitar el costo de findOne con email mal formado.

Verificar duplicado con findOne antes de create	Mejor UX: mensaje claro de "email ya registrado" en vez de un error genérico de MongoDB (E11000).

Mismo mensaje para "usuario no existe" y "password incorrecto"	Prevención de enumeración de usuarios. Si devolviéramos "usuario no existe", un atacante podría mapear qué emails están registrados.

user.password = undefined en login	El schema tiene select: false, pero al usar .select('+password') lo traemos explícitamente. Lo limpiamos antes de retornar.

# Paso 1.4.2: Sanity check del servicio

bash
cd server
node -e "
import('./src/services/auth.service.js').then(m => {
  console.log('✅ Servicio de auth carga correctamente');
  console.log('   Métodos exportados:', Object.keys(m).join(', '));
});
"
🚦 1.5 Middleware de Validación

# Paso 1.5.1: Crear el middleware (server/src/middlewares/validate.js)

Este middleware lee los errores que express-validator acumuló en req y responde con 400 si hay alguno.

javascript
// server/src/middlewares/validate.js
import { validationResult } from 'express-validator';

/**
 * Ejecuta después de las cadenas de validación de express-validator.
 * Si hay errores de validación, responde 400 con el detalle.
 * Si no, llama a next() para llegar al controlador.
 */
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Datos inválidos',
      errors: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
}
Formato de error consistente: { status, message, errors: [{ field, message }] }. Esto facilita el manejo en el frontend (mostrar el mensaje junto al campo correspondiente).

🎛️ 1.6 Controladores de Autenticación

El controlador adapta el servicio al mundo HTTP: lee req.body, llama al servicio, y formatea la respuesta res.

# Paso 1.6.1: Crear el controlador (server/src/controllers/auth.controller.js)

javascript
// server/src/controllers/auth.controller.js
import * as authService from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';

/**
 * POST /api/auth/register
 */
export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const { user, token } = await authService.registerUser({ name, email, password });

    res.status(201).json({
      status: 'success',
      data: {
        user: user.toJSON(), // toJSON elimina password y __v
        token,
      },
    });
  } catch (err) {
    next(err); // El error handler global formatea
  }
}

/**
 * POST /api/auth/login
 */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, token } = await authService.loginUser({ email, password });

    res.status(200).json({
      status: 'success',
      data: {
        user: user.toJSON(),
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me (requiere middleware protect)
 */
export async function getMe(req, res, next) {
  try {
    // req.user fue adjuntado por el middleware protect
    res.status(200).json({
      status: 'success',
      data: { user: req.user.toJSON() },
    });
  } catch (err) {
    next(err);
  }
}
Decisiones:

Detalle	Justificación
try/catch + next(err)	Los controladores no manejan errores: los delegan al error handler global. Centralización.
user.toJSON()	El schema ya transforma: elimina password y __v. Doble seguridad.
Status codes	201 (Created) para registro, 200 (OK) para login, 200 para me.
🛡️ 1.7 Middlewares de Autenticación

# Paso 1.7.1: Crear server/src/middlewares/auth.middleware.js

javascript
// server/src/middlewares/auth.middleware.js
import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';

/**
 * Verifica el JWT del header Authorization y adjunta el usuario a req.user.
 * Rechaza con 401 si no hay token, es inválido, expiró, o el usuario ya no existe.
 */
export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError('Token no proporcionado', 401);
    }

    const token = header.split(' ')[1];
    const decoded = verifyToken(token); // Lanza AppError si es inválido/expirado

    // Re-fetch del usuario: garantiza que existe y permite usar su rol ACTUAL
    // (aunque el token tenga un rol viejo si cambió)
    const user = await User.findById(decoded.id);
    if (!user) {
      throw new AppError('El usuario del token ya no existe', 401);
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restringe la ruta a usuarios con role === 'admin'.
 * Debe usarse SIEMPRE después de `protect`.
 */
export function admin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return next(new AppError('Acceso denegado: se requiere rol admin', 403));
  }
  next();
}
¿Por qué re-fetch del usuario en cada request (protect)?

Estrategia	Ventaja	Desventaja
Re-fetch (elegido)	Rol siempre actualizado. Detecta usuarios borrados.	1 query extra por request.
Confiar solo en el token	0 queries extra.	Rol obsoleto hasta que expire el token. Usuarios borrados siguen "funcionando".
Para un ecommerce donde el rol admin controla borrar productos, la consistencia es más valiosa que el ahorro de 1 query. Con índice en _id (default en Mongo), el costo es despreciable.

🛣️ 1.8 Rutas de Autenticación

# Paso 1.8.1: Crear server/src/routes/auth.routes.js

javascript
// server/src/routes/auth.routes.js
import { Router } from 'express';
import { body } from 'express-validator';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = Router();

// ─── Validaciones reutilizables ───────────────────────────
const registerValidators = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Nombre entre 2 y 50 caracteres'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(/[A-Z]/)
    .withMessage('La contraseña debe contener al menos una mayúscula')
    .matches(/[a-z]/)
    .withMessage('La contraseña debe contener al menos una minúscula')
    .matches(/[0-9]/)
    .withMessage('La contraseña debe contener al menos un número'),
];

const loginValidators = [
  body('email').trim().isEmail().withMessage('Email inválido').normalizeEmail(),
  body('password').isString().notEmpty().withMessage('Password requerido'),
];

// ─── Endpoints ────────────────────────────────────────────
router.post('/register', registerValidators, validate, authController.register);
router.post('/login', loginValidators, validate, authController.login);
router.get('/me', protect, authController.getMe);

export default router;
Nota sobre normalizeEmail(): convierte User@Example.com → user@example.com. Consistente con el lowercase: true del schema.

🔌 1.9 Rate Limiter Específico para Auth

Los endpoints de auth son los más atacados (fuerza bruta, credential stuffing). El rate limiter global (100 req/15min) es demasiado permisivo para login.

# Paso 1.9.1: Añadir limiter estricto en server/src/routes/auth.routes.js

Al inicio del archivo, importa rateLimit y crea un limiter:

javascript
// server/src/routes/auth.routes.js (fragmento)
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
// ...otros imports

const router = Router();

// 🔒 Limiter estricto SOLO para login/register
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 intentos por IP+ventana
  message: {
    status: 429,
    message: 'Demasiados intentos de autenticación. Intenta más tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ...validadores...

router.post('/register', authLimiter, registerValidators, validate, authController.register);
router.post('/login', authLimiter, loginValidators, validate, authController.login);
router.get('/me', protect, authController.getMe);

export default router;
💡 /auth/me NO lleva limiter estricto porque se llama frecuentemente desde el frontend al cargar la app. Hereda el limiter global de /api.
🔗 1.10 Wiring en app.js

# Paso 1.10.1: Modificar server/src/app.js

Añade el import y el app.use:

javascript
// server/src/app.js (arriba)
import authRoutes from './routes/auth.routes.js';

// ...middlewares existentes...

// ─── Rutas de la API ──────────────────────────────────────
app.use('/api/auth', authRoutes);
// app.use('/api/products', productRoutes);   // Fase 2
// app.use('/api/cart', cartRoutes);           // Fase 2
// app.use('/api/orders', orderRoutes);        // Fase 2
Resultado: el endpoint final queda como POST /api/auth/register, POST /api/auth/login, GET /api/auth/me.

✅ 1.11 Testing Manual con curl

Antes de empezar: reinicia el backend (Ctrl+C y npm run dev en server/).

Prueba 1: Registro exitoso

bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ana García",
    "email": "ana@example.com",
    "password": "Password123"
  }'
Respuesta esperada (201):

json
{
  "status": "success",
  "data": {
    "user": {
      "_id": "672c1a3f8e...",
      "name": "Ana García",
      "email": "ana@example.com",
      "role": "user",
      "createdAt": "2026-10-21T14:30:00.000Z",
      "updatedAt": "2026-10-21T14:30:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
  }
}
Verifica: password NO aparece. _id y role sí.

Prueba 2: Email duplicado

bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Otra Ana",
    "email": "ana@example.com",
    "password": "AnotherPass123"
  }'
Respuesta esperada (409):

json
{ "status": "error", "message": "El email ya está registrado" }
Prueba 3: Validación (password débil)

bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"123"}'
Respuesta esperada (400):

json
{
  "status": "error",
  "message": "Datos inválidos",
  "errors": [
    { "field": "password", "message": "La contraseña debe tener al menos 8 caracteres" },
    { "field": "password", "message": "La contraseña debe contener al menos una mayúscula" }
  ]
}
Prueba 4: Login exitoso

bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"Password123"}'
Respuesta esperada (200): estructura similar a registro, con token.

Guarda el token en una variable:

bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"Password123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Token: $TOKEN"
Prueba 5: Login con password incorrecto

bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"WrongPass123"}'
Respuesta esperada (401): {"status":"error","message":"Credenciales inválidas"}

Prueba 6: Login con email inexistente

bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"noexiste@example.com","password":"Whatever123"}'
Respuesta esperada (401): Mismo mensaje que la prueba 5. Esto es correcto (anti-enumeración).

Prueba 7: GET /auth/me con token válido

bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
Respuesta esperada (200):

json
{
  "status": "success",
  "data": { "user": { "_id": "...", "name": "Ana García", "email": "ana@example.com", "role": "user" } }
}
Prueba 8: GET /auth/me sin token

bash
curl http://localhost:3000/api/auth/me
Respuesta esperada (401): {"status":"error","message":"Token no proporcionado"}

Prueba 9: GET /auth/me con token inválido

bash
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer token-falso"
Respuesta esperada (401): {"status":"error","message":"Token inválido"}

Prueba 10: Rate limit de auth

Ejecuta 11 veces seguidas el login fallido:

bash
for i in {1..11}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"wrong"}'
done
Deberías ver 401 las primeras 10, y 429 la 11ª.

Prueba 11: Crear admin manualmente (para fases siguientes)

Como no hay endpoint público para crear admins (correcto por seguridad), lo hacemos por Mongo:

bash
# Con mongosh local
mongosh "mongodb://127.0.0.1:27017/e_commerce_01" --eval '
  db.users.updateOne({ email: "ana@example.com" }, { $set: { role: "admin" } })
'
O con Atlas: ve a la colección users en la UI y edita el documento.

Verifica que el nuevo token incluye el rol:

bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"Password123"}' | \
  grep -o '"role":"[^"]*'
# → "role":"admin"
✅ Checklist de validación backend:

□ Registro exitoso devuelve 201 + token + user sin password.
□ Email duplicado devuelve 409.
□ Validaciones devuelven 400 con detalle por campo.
□ Login exitoso devuelve 200 + token.
□ Password incorrecto y usuario inexistente devuelven mismo 401.
□ /auth/me con token válido devuelve el usuario.
□ /auth/me sin token o con token inválido devuelve 401.
□ Rate limit funciona (11º intento = 429).
Commit del backend:

bash
git add server/
git commit -m "feat(server): auth module with JWT

- User model with bcrypt hash (rounds=12)
- Auth service: register, login, getUserById
- POST /api/auth/register, /login and GET /me
- protect and admin middlewares
- express-validator on auth routes
- Stricter rate-limit on auth endpoints"
⚛️ 1.12 Frontend: Autenticación

# Paso 1.12.1: Añadir el interceptor a client/src/services/api.js

Modifica el archivo existente:

javascript
// client/src/services/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// 🔐 Request interceptor: añade JWT automáticamente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 🚨 Response interceptor: maneja 401 globalmente
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Token expirado o inválido → logout silencioso
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // No redirigimos aquí: cada contexto decide. Solo limpiamos el token.
    }
    return Promise.reject(error);
  }
);

export default api;
💡 Con esto, cualquier llamada api.get('/auth/me') lleva el token automáticamente. Los componentes no tocan localStorage directamente.
# Paso 1.12.2: Crear client/src/context/AuthContext.jsx

jsx
// client/src/context/AuthContext.jsx
import { createContext, useReducer, useEffect } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

const initialState = {
  user: null,
  token: null,
  loading: true, // true hasta que terminemos de verificar la sesión inicial
  error: null,
};

function authReducer(state, action) {
  switch (action.type) {
    case 'AUTH_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        loading: false,
        error: null,
      };
    case 'AUTH_ERROR':
      return { ...state, loading: false, error: action.payload, user: null, token: null };
    case 'LOGOUT':
      return { ...state, user: null, token: null, loading: false, error: null };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // ─── Al montar: restaurar sesión desde localStorage ─────
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      dispatch({ type: 'AUTH_ERROR', payload: null }); // loading=false
      return;
    }

    // Verificar el token con el backend (garantiza que sigue siendo válido)
    api
      .get('/auth/me')
      .then(({ data }) => {
        dispatch({
          type: 'AUTH_SUCCESS',
          payload: { user: data.data.user, token },
        });
      })
      .catch(() => {
        localStorage.removeItem('token');
        dispatch({ type: 'AUTH_ERROR', payload: null });
      });
  }, []);

  // ─── Acciones ───────────────────────────────────────────
  async function login(email, password) {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.data.token);
      dispatch({ type: 'AUTH_SUCCESS', payload: data.data });
      return data.data;
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.message ||
        'Error al iniciar sesión';
      dispatch({ type: 'AUTH_ERROR', payload: message });
      throw err;
    }
  }

  async function register(name, email, password) {
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      localStorage.setItem('token', data.data.token);
      dispatch({ type: 'AUTH_SUCCESS', payload: data.data });
      return data.data;
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.message ||
        'Error al registrar';
      dispatch({ type: 'AUTH_ERROR', payload: message });
      throw err;
    }
  }

  function logout() {
    localStorage.removeItem('token');
    dispatch({ type: 'LOGOUT' });
  }

  function clearError() {
    dispatch({ type: 'CLEAR_ERROR' });
  }

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
Decisiones:

Detalle	Justificación
loading: true inicial	El <ProtectedRoute> no debe redirigir a /login mientras verificamos el token.
Verificación al montar con /auth/me	Si el token está expirado o el usuario fue borrado, lo detectamos y limpiamos.
useReducer	El estado de auth tiene varias transiciones (login, register, logout, error). useReducer es más claro que 5 useState.
clearError()	Permite a las páginas limpiar el error al desmontar (evita "fantasmas" de errores de una página a otra).
# Paso 1.12.3: Crear client/src/hooks/useAuth.js

javascript
// client/src/hooks/useAuth.js
import { useContext } from 'react';
import AuthContext from '../context/AuthContext.jsx';

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return context;
}
# Paso 1.12.4: Crear client/src/components/ProtectedRoute.jsx

jsx
// client/src/components/ProtectedRoute.jsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ padding: 24 }}>Cargando…</div>;
  }

  if (!user) {
    // Guardamos la ruta de origen para volver tras login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  return children;
}
# Paso 1.12.5: Crear client/src/pages/LoginPage.jsx

jsx
// client/src/pages/LoginPage.jsx
import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function LoginPage() {
  const { login, user, loading, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Ya autenticado: redirige
  useEffect(() => {
    if (!loading && user) {
      navigate(from, { replace: true });
    }
  }, [user, loading, navigate, from]);

  // Limpiar error al desmontar
  useEffect(() => () => clearError(), [clearError]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch {
      // El error ya está en `error` del contexto
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '40px auto', padding: 24 }}>
      <h1>Iniciar sesión</h1>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          style={{ width: '100%', padding: 8, marginBottom: 12 }}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={{ width: '100%', padding: 8, marginBottom: 12 }}
        />

        {error && (
          <p role="alert" style={{ color: 'crimson', marginBottom: 12 }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} style={{ width: '100%', padding: 10 }}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        ¿No tienes cuenta? <Link to="/register">Regístrate</Link>
      </p>
    </main>
  );
}
# Paso 1.12.6: Crear client/src/pages/RegisterPage.jsx

jsx
// client/src/pages/RegisterPage.jsx
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function RegisterPage() {
  const { register, user, loading, error, clearError } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => () => clearError(), [clearError]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(form.name, form.email, form.password);
      navigate('/', { replace: true });
    } catch {
      // error manejado en el contexto
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '40px auto', padding: 24 }}>
      <h1>Crear cuenta</h1>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="name">Nombre</label>
        <input
          id="name" name="name" type="text" value={form.name} onChange={handleChange}
          required autoComplete="name"
          style={{ width: '100%', padding: 8, marginBottom: 12 }}
        />

        <label htmlFor="email">Email</label>
        <input
          id="email" name="email" type="email" value={form.email} onChange={handleChange}
          required autoComplete="email"
          style={{ width: '100%', padding: 8, marginBottom: 12 }}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password" name="password" type="password" value={form.password} onChange={handleChange}
          required autoComplete="new-password" minLength={8}
          style={{ width: '100%', padding: 8, marginBottom: 12 }}
        />
        <small style={{ display: 'block', marginBottom: 12, color: '#666' }}>
          Mínimo 8 caracteres, con mayúscula, minúscula y número.
        </small>

        {error && (
          <p role="alert" style={{ color: 'crimson', marginBottom: 12 }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} style={{ width: '100%', padding: 10 }}>
          {submitting ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
      </p>
    </main>
  );
}
# Paso 1.12.7: Crear client/src/pages/HomePage.jsx (temporal)

jsx
// client/src/pages/HomePage.jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function HomePage() {
  const { user, logout, loading } = useAuth();

  if (loading) return <p style={{ padding: 24 }}>Cargando…</p>;

  return (
    <main style={{ padding: 24 }}>
      <h1>🛒 e_commerce_01</h1>
      {user ? (
        <>
          <p>
            Hola, <strong>{user.name}</strong> ({user.role})
          </p>
          <button onClick={logout}>Cerrar sesión</button>
        </>
      ) : (
        <p>
          <Link to="/login">Iniciar sesión</Link> | <Link to="/register">Registrarse</Link>
        </p>
      )}
    </main>
  );
}
# Paso 1.12.8: Actualizar client/src/App.jsx con el router

jsx
// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Ejemplo de ruta protegida para fase posterior */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <div style={{ padding: 24 }}>
                  <h2>Panel Admin</h2>
                  <p>Próximamente en Fase 2.</p>
                </div>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
✅ Checklist de validación frontend:

□ npm run dev en client/ arranca sin errores.
□ Al visitar / sin login: aparecen enlaces "Iniciar sesión" y "Registrarse".
□ Registrar nuevo usuario → redirige a / y muestra "Hola, <nombre>".
□ Refrescar la página → la sesión persiste (gracias a /auth/me).
□ Logout → vuelve a mostrar los enlaces.
□ Intentar /admin sin login → redirige a /login.
□ Intentar /admin logueado como user → redirige a /.
□ Intentar /admin logueado como admin → muestra "Panel Admin".
□ Login con password incorrecto → muestra "Credenciales inválidas".
Commit del frontend:

bash
git add client/
git commit -m "feat(client): auth flow with Context API

- AuthContext with useReducer (login, register, logout, restore session)
- useAuth hook
- LoginPage and RegisterPage
- ProtectedRoute with role support
- Axios interceptors for JWT and 401 handling"
📊 1.13 Resumen Visual de la Fase 1

Flujo de registro

text
┌──────────────┐    POST /api/auth/register    ┌────────────────────┐
│ RegisterPage │──────────────────────────────▶│ auth.routes.js     │
│ (React)      │    { name, email, password }  │ ├─ authLimiter     │
└──────────────┘                               │ ├─ validators      │
       ▲                                       │ └─ validate        │
       │                                       └─────────┬──────────┘
       │                                                 │
       │                                       ┌─────────▼──────────┐
       │                                       │ auth.controller    │
       │                                       │   .register        │
       │                                       └─────────┬──────────┘
       │                                                 │
       │                                       ┌─────────▼──────────┐
       │                                       │ auth.service       │
       │                                       │   .registerUser    │
       │                                       │ 1. check dup       │
       │                                       │ 2. User.create     │
       │                                       │   (bcrypt hook)    │
       │                                       │ 3. signToken       │
       │                                       └─────────┬──────────┘
       │                                                 │
       │   201 { user (sin pwd), token }                 │
       └─────────────────────────────────────────────────┘
Flujo de request protegida

text
┌───────────────┐  GET /api/auth/me        ┌─────────────────────┐
│ ProtectedRoute│─────────────────────────▶│ protect middleware  │
│ (React)       │  Authorization: Bearer … │ 1. verify JWT       │
└───────────────┘                          │ 2. fetch user (DB)  │
       ▲                                   │ 3. req.user = user  │
       │                                   └──────────┬──────────┘
       │                                              │
       │                                   ┌──────────▼──────────┐
       │                                   │ auth.controller     │
       │                                   │   .getMe            │
       │                                   └──────────┬──────────┘
       │                                              │
       │    200 { user }                              │
       └──────────────────────────────────────────────┘
Persistencia de sesión (al refrescar la app)

text
Browser                    React                       Backend
  │                          │                            │
  │── refresh page ─────────▶│                            │
  │                          │ AuthProvider monta         │
  │                          │ ¿token en localStorage?    │
  │                          │   sí → GET /auth/me ──────▶│
  │                          │                            │ verify JWT
  │                          │                            │ fetch user
  │                          │◀──── 200 { user } ─────────│
  │                          │ AUTH_SUCCESS               │
  │◀── UI con sesión ────────│                            │
