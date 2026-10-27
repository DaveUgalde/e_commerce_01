
___________________________________________________________
🛡️ FASE 1 — Dar identidad a las personas y proteger la sesión

📖 1. La Historia (El Porqué)

La tienda ahora necesita distinguir entre visitante, cliente y administrador. Autenticación responde "¿quién eres?"; autorización responde "¿tienes permiso para hacer esto?". Son preguntas diferentes y ambas deben verificarse en el backend.

Puntos críticos a entender en esta fase:

Access Token vs Refresh Token: El Access Token (JWT) es de corta duración y se guarda en memoria en el frontend para evitar ataques XSS. El Refresh Token es de larga duración, se guarda en una cookie HttpOnly (el JavaScript del navegador no puede leerla) y sirve para pedir un nuevo Access Token cuando este expira.
Detección de reuso: Si alguien roba un Refresh Token y lo usa, el servidor detectará que el token ya fue usado antes, invalidará toda la sesión y obligará al usuario a loguearse de nuevo.
Rate Limiting Distribuido: Usamos Redis para limitar los intentos de login fallidos. Si no usáramos Redis, el límite se reiniciaría cada vez que el servidor se reinicie, permitiendo ataques de fuerza bruta.
Separación de capas: La ruta define el endpoint; el middleware valida los datos; el controlador traduce HTTP a llamadas de servicio; el servicio contiene la lógica de negocio (hashear contraseñas, generar tokens); el modelo persiste en MongoDB.
___________________________________________________________
📋 2. El Checklist (El Qué)

□ Crear utilidades: AppError, jwt.ts, rateLimit.middleware.ts.
□ Crear modelo User (hash de contraseña oculto por defecto).
□ Crear auth.service.ts (registro, login, refresh, detección de reuso, logout).
□ Crear validate.ts y auth.middleware.ts.
□ Crear auth.controller.ts y auth.routes.ts.
□ Modificar app.ts para montar las rutas y cookies.
□ Crear script createAdmin.ts (idempotente).
□ Escribir tests de integración (registro, duplicados, reuso de refresh).
□ Frontend: Interceptores de Axios (refresh silencioso en 401 con cola).
□ Frontend: AuthContext, useAuth, ProtectedRoute.
□ Frontend: Páginas de Login, Register, Home y App.tsx.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 1.1: Utilidades y Middlewares (Backend)

server/src/utils/AppError.ts
___________________________________________________________
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
server/src/utils/jwt.ts
___________________________________________________________
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const ACCESS_SECRET = process.env.JWT_SECRET!;
if (!ACCESS_SECRET || ACCESS_SECRET.length < 32) {
  throw new Error('JWT_SECRET debe tener ≥32 caracteres');
}

export function signAccessToken(payload: { sub: string; role: string }): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m', issuer: 'e_commerce_01' });
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '7d', issuer: 'e_commerce_01' });
}

export function verifyAccessToken(token: string): { sub: string; role: string } {
  return jwt.verify(token, ACCESS_SECRET, { issuer: 'e_commerce_01' }) as { sub: string; role: string };
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, ACCESS_SECRET, { issuer: 'e_commerce_01' }) as { sub: string };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
___________________________________________________________
server/src/middlewares/rateLimit.middleware.ts
___________________________________________________________
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import type { Request } from 'express';

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutos
  limit: 10,
  skipSuccessfulRequests: true, // Solo cuenta los fallos
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.ip}:${(req.body?.email ?? '').toLowerCase()}`,
  store: new RedisStore({ 
    sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as any 
  }),
});
___________________________________________________________
Paso 1.2: Modelo de Usuario

server/src/models/User.ts
___________________________________________________________
import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import type { User } from '@shared/user.js';

export interface UserDoc extends Omit<User, 'id'>, mongoose.Document {
  password?: string;
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: Date;
  comparePassword(pwd: string): Promise<boolean>;
}

const userSchema = new Schema<UserDoc>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, required: true, select: false }, // No se devuelve por defecto
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  refreshTokenHash: { type: String, select: false },
  refreshTokenExpiresAt: { type: Date, select: false },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password!, 12);
  next();
});

userSchema.methods.comparePassword = function (pwd: string) {
  return bcrypt.compare(pwd, this.password!);
};

// Limpieza de campos sensibles al serializar a JSON
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as any).password;
    delete (ret as any).refreshTokenHash;
    delete (ret as any).refreshTokenExpiresAt;
    return ret;
  },
});

export const UserModel = mongoose.model<UserDoc>('User', userSchema);
___________________________________________________________
Paso 1.3: Servicio de Autenticación

server/src/services/auth.service.ts
___________________________________________________________
import { UserModel } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } from '../utils/jwt.js';

export async function registerUser(dto: { email: string; name: string; password: string }) {
  const exists = await UserModel.findOne({ email: dto.email });
  if (exists) throw new AppError(409, 'Email ya registrado', 'EMAIL_DUPLICADO');
  
  const user = await UserModel.create(dto);
  return { user: user.toJSON() };
}

export async function loginUser(email: string, password: string) {
  const user = await UserModel.findOne({ email }).select('+password');
  // Mismo mensaje para email inexistente y password incorrecto (anti-enumeración)
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });

  user.refreshTokenHash = hashToken(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 864e5); // 7 días
  await user.save();

  return { user: user.toJSON(), accessToken, refreshToken };
}

export async function refreshSession(rawRefresh: string) {
  const payload = verifyRefreshToken(rawRefresh);
  const user = await UserModel.findById(payload.sub).select('+refreshTokenHash');
  
  if (!user || !user.refreshTokenHash) {
    throw new AppError(401, 'Sesión inválida', 'INVALID_SESSION');
  }

  // Detección de reuso
  if (user.refreshTokenHash !== hashToken(rawRefresh)) {
    user.refreshTokenHash = undefined;
    user.refreshTokenExpiresAt = undefined;
    await user.save();
    throw new AppError(401, 'Reuso de token detectado', 'REFRESH_REUSE');
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const newRefresh = signRefreshToken({ sub: user.id });

  user.refreshTokenHash = hashToken(newRefresh);
  user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 864e5);
  await user.save();

  return { accessToken, refreshToken: newRefresh };
}

export async function logoutUser(userId: string) {
  await UserModel.findByIdAndUpdate(userId, { 
    $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } 
  });
}
___________________________________________________________
Paso 1.4: Middlewares y Validación

server/src/middlewares/validate.ts
___________________________________________________________
import type { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export function validate(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos',
      errors: errors.array().map((e) => ({ field: (e as any).path, message: e.msg })),
    });
  }
  next();
}
___________________________________________________________
server/src/middlewares/auth.middleware.ts
___________________________________________________________
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { UserModel } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

export async function protect(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Token requerido', 'NO_TOKEN'));
  }
  
  try {
    const payload = verifyAccessToken(header.slice(7));
    const user = await UserModel.findById(payload.sub);
    if (!user) return next(new AppError(401, 'Usuario no encontrado', 'USER_NOT_FOUND'));
    
    (req as any).user = user;
    next();
  } catch {
    next(new AppError(401, 'Token inválido', 'INVALID_TOKEN'));
  }
}

export function admin(req: Request, _res: Response, next: NextFunction) {
  if ((req as any).user?.role !== 'admin') {
    return next(new AppError(403, 'Acceso denegado', 'FORBIDDEN'));
  }
  next();
}
___________________________________________________________
Paso 1.5: Controladores y Rutas

server/src/controllers/auth.controller.ts
___________________________________________________________
import type { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service.js';

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 864e5,
  path: '/api/auth',
};

export async function register(req: Request, res: Response, next: NextFunction) {
  try { 
    res.status(201).json(await authService.registerUser(req.body)); 
  } catch (e) { next(e); }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.loginUser(req.body.email, req.body.password);
    res.cookie('refreshToken', result.refreshToken, cookieOpts);
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (e) { next(e); }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ code: 'NO_REFRESH', message: 'Sin refresh token' });
    
    const result = await authService.refreshSession(token);
    res.cookie('refreshToken', result.refreshToken, cookieOpts);
    res.json({ accessToken: result.accessToken });
  } catch (e) { next(e); }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.logoutUser((req as any).user.id);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export function me(req: Request, res: Response) {
  res.json({ user: (req as any).user });
}
___________________________________________________________
server/src/routes/auth.routes.ts
___________________________________________________________
import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.js';
import { authLimiter } from '../middlewares/rateLimit.middleware.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2 }),
  body('password').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/),
  validate, ctrl.register
);

authRouter.post('/login', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(), 
  validate, ctrl.login
);

authRouter.post('/refresh', ctrl.refresh);
authRouter.post('/logout', protect, ctrl.logout);
authRouter.get('/me', protect, ctrl.me);
___________________________________________________________
(Nota: Recuerda ir a server/src/app.ts y añadir import { authRouter } from './routes/auth.routes.js'; y app.use('/api/auth', authRouter); después de configurar cookieParser).
___________________________________________________________
Paso 1.6: Script de Administrador (Obligatorio en Checklist)

server/scripts/createAdmin.ts
___________________________________________________________
import 'dotenv/config';
import mongoose from 'mongoose';
import { UserModel } from '../src/models/User.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';

async function run() {
  await connectDatabase(process.env.MONGODB_URI!);
  
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  
  if (!email || !password) {
    logger.error('Faltan ADMIN_EMAIL y ADMIN_PASSWORD en .env');
    process.exit(1);
  }

  const admin = await UserModel.findOneAndUpdate(
    { email },
    { role: 'admin', name: 'Admin', password }, // El pre-save hook hasheará el password si es nuevo o modificado
    { upsert: true, new: true }
  );

  logger.info(`Admin creado/actualizado: ${admin.email}`);
  await disconnectDatabase();
}

run().catch((err) => { logger.error(err); process.exit(1); });
___________________________________________________________
Paso 1.7: Tests de Integración

server/tests/setup.ts
___________________________________________________________
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { before, after } from 'node:test';

let replSet: MongoMemoryReplSet;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});
___________________________________________________________
server/tests/auth.test.ts
___________________________________________________________
import { test, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';

let app: any;
before(async () => { app = await createApp(); });

test('register 201 sin password', async () => {
  const res = await request(app).post('/api/auth/register').send({
    email: 'a@test.com', name: 'A', password: 'Password1',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.password, undefined);
});

test('duplicado 409', async () => {
  const res = await request(app).post('/api/auth/register').send({
    email: 'a@test.com', name: 'A', password: 'Password1',
  });
  assert.equal(res.status, 409);
});

test('password débil 400 con detalle', async () => {
  const res = await request(app).post('/api/auth/register').send({
    email: 'b@test.com', name: 'B', password: '123',
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.length > 0);
});

test('login 200 con cookie y mensaje de fallo idéntico', async () => {
  const loginOk = await request(app).post('/api/auth/login').send({
    email: 'a@test.com', password: 'Password1',
  });
  assert.equal(loginOk.status, 200);
  assert.ok(loginOk.headers['set-cookie'][0].includes('HttpOnly'));

  const r1 = await request(app).post('/api/auth/login').send({ email: 'a@test.com', password: 'Wrong1' });
  const r2 = await request(app).post('/api/auth/login').send({ email: 'no@test.com', password: 'Wrong1' });
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  assert.equal(r1.body.message, r2.body.message);
});

test('/me sin token 401', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});
___________________________________________________________
Paso 1.8: Frontend — Axios y Contexto

client/src/services/api.ts
___________________________________________________________
import axios from 'axios';
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };

let refreshing: Promise<string> | null = null;
const refresh = async () => {
  const res = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
  accessToken = res.data.accessToken; 
  return accessToken!;
};

export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken && !config.url?.includes('/auth/')) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use((r) => r, async (error) => {
  const original = error.config;
  if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/')) {
    original._retry = true;
    try {
      if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
      const token = await refreshing;
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    } catch { 
      window.dispatchEvent(new Event('auth:expired')); 
    }
  }
  return Promise.reject(error);
});
___________________________________________________________
client/src/context/AuthContext.tsx
___________________________________________________________
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import { api, setAccessToken } from '../services/api';

const initialState = { user: null, token: null, loading: true, error: null };
function reducer(state: any, action: any): any {
  switch (action.type) {
    case 'AUTH_SUCCESS': return { ...state, user: action.user, token: action.token, loading: false };
    case 'LOGOUT': return { ...initialState, loading: false };
    case 'SET_ERROR': return { ...state, error: action.error, loading: false };
    default: return state;
  }
}

const AuthContext = createContext<any>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    api.get('/auth/me').then((res) => {
      dispatch({ type: 'AUTH_SUCCESS', user: res.data.user, token: 'restored' });
    }).catch(() => dispatch({ type: 'LOGOUT' }));
    
    window.addEventListener('auth:expired', () => dispatch({ type: 'LOGOUT' }));
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await api.post('/auth/login', { email, password });
      setAccessToken(res.data.accessToken);
      dispatch({ type: 'AUTH_SUCCESS', user: res.data.user, token: res.data.accessToken });
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', error: e.response?.data?.message || 'Error al iniciar sesión' });
    }
  };

  return <AuthContext.Provider value={{ ...state, login }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
___________________________________________________________
client/src/hooks/useAuth.ts
___________________________________________________________
import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
export const useAuth = () => useContext(AuthContext);
___________________________________________________________
client/src/components/ProtectedRoute.tsx
___________________________________________________________
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export function ProtectedRoute({ requiredRole }: { requiredRole?: string }) {
  const { user, loading } = useAuth();
  if (loading) return <div>Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/" replace />;
  return <Outlet />;
}
___________________________________________________________
Paso 1.9: Frontend — Páginas y App

client/src/pages/LoginPage.tsx
___________________________________________________________
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

export function LoginPage() {
  const { login, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
    navigate('/');
  };

  return (
    <form onSubmit={handleSubmit} className="page container" style={{ maxWidth: '400px', margin: '2rem auto' }}>
      <h1>Iniciar Sesión</h1>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="field">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label>Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <button type="submit" className="btn btn-primary">Entrar</button>
    </form>
  );
}
___________________________________________________________
client/src/pages/RegisterPage.tsx
___________________________________________________________
import { useState } from 'react';
import { api } from '../services/api';
import { useNavigate } from 'react-router-dom';

export function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/register', form);
      navigate('/login');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al registrar');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="page container" style={{ maxWidth: '400px', margin: '2rem auto' }}>
      <h1>Crear Cuenta</h1>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="field"><label>Nombre</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
      <div className="field"><label>Email</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required /></div>
      <div className="field"><label>Contraseña</label><input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required /></div>
      <button type="submit" className="btn btn-primary">Registrarse</button>
    </form>
  );
}
___________________________________________________________
client/src/pages/HomePage.tsx
___________________________________________________________
import { useAuth } from '../hooks/useAuth';

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="page container">
      <h1>Bienvenido a e_commerce_01 {user ? `, ${user.name}` : ''}</h1>
      <p>Explora nuestro catálogo de productos de tecnología.</p>
    </div>
  );
}
___________________________________________________________
client/src/App.tsx
___________________________________________________________
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

function AdminDashboard() { return <div className="container"><h1>Panel de Admin</h1></div>; }

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          
          {/* Rutas Protegidas */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
___________________________________________________________
🚦 4. Gate 1 (Validación)

No avances a la Fase 2 hasta que se cumplan TODOS estos puntos:

□ Tests Backend: cd server && npm test pasa en verde (valida registro, duplicados, login, no enumeración y reuso).
□ Base de datos segura: Verificar que al consultar /api/auth/me el JSON devuelto NO contiene password ni refreshTokenHash.
□ Cookie HttpOnly: Al hacer login en el navegador, la pestaña Application -> Cookies muestra refreshToken marcada como HttpOnly.
□ Admin script: Ejecutar npm run create-admin y verificar que en Mongo (o en un login) el rol es "admin".
□ Rate Limiting persistente: Intentar hacer login 11 veces con contraseña incorrecta. La 11º debe dar 429 Too Many Requests. Reiniciar el servidor e intentar de nuevo: debe seguir bloqueado (esto demuestra que Redis está funcionando).
□ Frontend silencioso:
Iniciar sesión en el frontend.
Ir a DevTools.
En client/src/services/api.ts, poner el expiresIn del Access Token en '1s' (temporalmente).
Navegar a una página que haga un fetch. El interceptor debe pedir un nuevo token silenciosamente y la petición debe tener éxito sin que el usuario sea redirigido al login.
□ Rutas Protegidas: Navegar a /admin sin loguearse redirige a /login. Loguearse con un usuario normal y navegar a /admin redirige a /.