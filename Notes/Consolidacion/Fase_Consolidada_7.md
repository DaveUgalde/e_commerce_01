
___________________________________________________________
🔒 FASE 7 — Privacidad, seguridad y obligaciones del negocio

📖 1. La Historia (El Porqué)

La seguridad no es una librería que se instala una vez. Es una serie de decisiones sobre datos, acceso, retención, proveedores y comportamiento ante solicitudes abusivas.

Puntos críticos a entender en esta fase:

GDPR Operativo (No solo un checkbox): Si un usuario pide borrar su cuenta, no podemos borrar sus pedidos porque tenemos obligaciones fiscales. La solución es anonimizar: cambiamos su nombre por "Deleted User" y su email por uno falso, pero mantenemos el monto y el país del pedido. Además, revocamos sus sesiones (refresh tokens).
Derecho de Exportación: El usuario tiene derecho a descargar todo lo que sabemos de él en un JSON.
Consentimiento de Cookies: Las cookies no esenciales (como Sentry o PostHog) no deben cargarse hasta que el usuario haga clic en "Aceptar todo".
CSP (Content Security Policy): Configuramos Helmet para bloquear scripts maliciosos (XSS). Solo permitimos cargar scripts de nuestro dominio y de Stripe.
Dependabot y Auditoría: Automatizamos la revisión de vulnerabilidades en las dependencias. Si hay un paquete con un fallo de seguridad "High", la CI debe fallar.

___________________________________________________________
📋 2. El Checklist (El Qué)

□ Backend (Dependencias): Instalar speakeasy, qrcode (si no se hizo en Fase 3), vanilla-cookieconsent (Frontend).
□ Backend (Modelo): Añadir acceptedTermsAt y termsVersion a User.ts.
□ Backend (Auth): Modificar registerUser para exigir acceptedTerms.
□ Backend (GDPR): Crear gdpr.service.ts con exportUserData y deleteUserAccount.
□ Backend (Rutas): Crear user.routes.ts (GET /me/export, DELETE /me).
□ Backend (Seguridad): Configurar CSP completo con Helmet. Configurar Rate Limiting específico para checkout.
□ Frontend (Legal): Crear AccountSettingsPage.tsx (botones de exportar/eliminar).
□ Frontend (Legal): Crear CookieConsent.tsx con vanilla-cookieconsent.
□ CI/CD: Crear .github/dependabot.yml y añadir npm audit al CI.

___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 7.1: Backend — Términos y Condiciones

Actualizar server/src/models/User.ts
___________________________________________________________
// Añadir al Schema:
acceptedTermsAt: { type: Date, required: true },
termsVersion: { type: String, required: true, default: '1.0' },
___________________________________________________________
Actualizar server/src/services/auth.service.ts
___________________________________________________________
export async function registerUser(dto: { email: string; name: string; password: string; acceptedTerms: boolean }) {
  if (!dto.acceptedTerms) {
    throw new AppError(400, 'Debe aceptar los términos y condiciones', 'TERMS_REQUIRED');
  }
  
  const exists = await UserModel.findOne({ email: dto.email });
  if (exists) throw new AppError(409, 'Email ya registrado', 'EMAIL_DUPLICADO');
  
  const user = await UserModel.create({ 
    email: dto.email, 
    name: dto.name, 
    password: dto.password,
    acceptedTermsAt: new Date(), 
    termsVersion: '1.0' 
  });
  
  return { user: user.toJSON() };
}
___________________________________________________________
Actualizar server/src/routes/auth.routes.ts (Añadir validador)
___________________________________________________________
authRouter.post('/register', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2 }),
  body('password').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/),
  body('acceptedTerms').isBoolean().equals('true').withMessage('Debe aceptar los términos'),
  validate, ctrl.register
);
___________________________________________________________
Paso 7.2: Backend — Servicio GDPR (Exportar y Eliminar)

server/src/services/gdpr.service.ts
___________________________________________________________
import crypto from 'node:crypto'; // CRÍTICO
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/User.js';
import { OrderModel } from '../models/Order.js';
import { CartModel } from '../models/Cart.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { AppError } from '../utils/AppError.js';

export async function exportUserData(userId: string) {
  const [user, orders, cart, audits] = await Promise.all([
    UserModel.findById(userId).lean(),
    OrderModel.find({ userId }).lean(),
    CartModel.findOne({ userId }).lean(),
    AuditLogModel.find({ userId }).lean(),
  ]);

  if (!user) throw new AppError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');

  // Excluir campos sensibles
  const { password, refreshTokenHash, twoFactorSecret, twoFactorBackupCodes, ...safeUser } = user as any;

  return { 
    user: safeUser, 
    orders, 
    cart, 
    audits, 
    exportedAt: new Date().toISOString() 
  };
}

export async function deleteUserAccount(userId: string) {
  // 1. Anonimizar Usuario
  await UserModel.findByIdAndUpdate(userId, {
    email: `deleted_${userId}@anon.local`,
    name: 'Deleted User',
    password: await bcrypt.hash(crypto.randomUUID(), 12),
    role: 'user',
    refreshTokenHash: undefined,
    refreshTokenExpiresAt: undefined,
    twoFactorEnabled: false,
    twoFactorSecret: undefined,
    twoFactorBackupCodes: [],
  });

  // 2. Anonimizar PII en Orders (conservar datos fiscales)
  await OrderModel.updateMany({ userId }, {
    $set: {
      'shippingAddress.name': 'Deleted',
      'shippingAddress.phone': null,
      'shippingAddress.street': null,
      // Mantenemos city, country, total, taxAmount, createdAt por obligación fiscal
    },
  });

  // 3. Eliminar carrito
  await CartModel.deleteOne({ userId });

  // 4. Anonimizar audit logs propios
  await AuditLogModel.updateMany({ userId }, {
    $set: { metadata: { anonymized: true }, ip: null },
  });
}

export function getDataRetentionPolicy() {
  return {
    user: { retention: 'Hasta eliminación de cuenta', basis: 'Consentimiento' },
    orders: { retention: '7 años', basis: 'Obligación fiscal' },
    cart: { retention: 'Hasta checkout o eliminación', basis: 'Ejecución de contrato' },
    auditLogs: { retention: '2 años', basis: 'Interés legítimo (seguridad)' },
  };
}
___________________________________________________________
Paso 7.3: Backend — Rutas de Usuario (GDPR)

server/src/routes/user.routes.ts
___________________________________________________________
import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { exportUserData, deleteUserAccount, getDataRetentionPolicy } from '../services/gdpr.service.js';
import { logoutUser } from '../services/auth.service.js';
import { UserModel } from '../models/User.js';
import { authLimiter } from '../middlewares/rateLimit.middleware.js';

export const userRouter = Router();
userRouter.use(protect);

userRouter.get('/me/export', authLimiter, async (req: any, res, next) => {
  try {
    res.setHeader('Content-Disposition', 'attachment; filename="mis-datos.json"');
    res.json(await exportUserData(req.user.id));
  } catch (e) { next(e); }
});

userRouter.delete('/me', authLimiter, async (req: any, res, next) => {
  try {
    const user = await UserModel.findById(req.user.id).select('+password');
    if (!user || !(await user.comparePassword(req.body.password))) {
      return res.status(401).json({ code: 'INVALID_PASSWORD', message: 'Contraseña incorrecta' });
    }
    
    await deleteUserAccount(req.user.id);
    await logoutUser(req.user.id);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

userRouter.get('/me/retention-policy', (_req, res) => res.json(getDataRetentionPolicy()));
___________________________________________________________
(Recuerda montar app.use('/api/user', userRouter); en app.ts).

Paso 7.4: Backend — Seguridad Avanzada (CSP y Rate Limit)

Actualizar server/src/app.ts (Helmet completo y Rate Limit)
___________________________________________________________
import helmet from 'helmet';
import { apiLimiter } from './middlewares/rateLimit.middleware.js';
import { checkoutLimiter } from './middlewares/rateLimit.middleware.js';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

// Rate limit global
app.use('/api', apiLimiter);

// Rate limit específico para checkout
app.use('/api/orders/checkout', checkoutLimiter);
___________________________________________________________
Paso 7.5: Frontend — Cookie Consent y Configuración

client/src/components/CookieConsent.tsx
___________________________________________________________
import { useEffect } from 'react';
import * as CookieConsentLib from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';

export function CookieConsent() {
  useEffect(() => {
    CookieConsentLib.run({
      categories: {
        necessary: { enabled: true, readOnly: true },
        analytics: {},
      },
      language: {
        default: 'es',
        translations: {
          es: {
            consentModal: {
              title: 'Usamos cookies',
              description: 'Necesarias siempre activas. Analítica opcional.',
              acceptAllBtn: 'Aceptar todo',
              acceptNecessaryBtn: 'Solo necesarias',
            },
          },
        },
      },
      onConsent: () => {
        if (CookieConsentLib.acceptedCategory('analytics')) {
          window.dispatchEvent(new Event('analytics:consent'));
        }
      },
    });
  }, []);
  return null;
}
___________________________________________________________
client/src/pages/AccountSettingsPage.tsx
___________________________________________________________
import { useState } from 'react';
import { api } from '../services/api';

export function AccountSettingsPage() {
  const [password, setPassword] = useState('');
  
  const handleExport = async () => {
    const res = await api.get('/user/me/export', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'mis-datos.json');
    document.body.appendChild(link);
    link.click();
  };

  const handleDelete = async () => {
    if (!confirm('¿Estás seguro? Esto anonimizará tu cuenta permanentemente.')) return;
    try {
      await api.delete('/user/me', { data: { password } });
      window.location.href = '/';
    } catch (e) {
      alert('Contraseña incorrecta');
    }
  };

  return (
    <div>
      <h1>Configuración de Cuenta</h1>
      <button onClick={handleExport}>Descargar mis datos (JSON)</button>
      <hr />
      <h3>Eliminar cuenta</h3>
      <input type="password" placeholder="Confirma tu contraseña" value={password} onChange={e => setPassword(e.target.value)} />
      <button onClick={handleDelete} style={{ background: 'red', color: 'white' }}>Eliminar mi cuenta</button>
    </div>
  );
}
___________________________________________________________
Paso 7.6: CI/CD — Dependabot y Auditoría

.github/dependabot.yml
___________________________________________________________
version: 2
updates:
  - package-ecosystem: npm
    directory: /server
    schedule: { interval: weekly }
  - package-ecosystem: npm
    directory: /client
    schedule: { interval: weekly }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
___________________________________________________________
Actualizar .github/workflows/ci.yml
___________________________________________________________
# Añadir al final de los steps de test-server:
- run: cd server && npm audit --audit-level=high

# Añadir al final de los steps de build-client:
- run: cd client && npm audit --audit-level=high
___________________________________________________________
🚦 4. Gate 7 (Validación)

No avances a la Fase 8 hasta que se cumplan TODOS estos puntos:

□ Registro con Términos: Intentar registrar un usuario sin acceptedTerms → debe devolver 400. Con acceptedTerms: true → 201.
□ Exportación GDPR: Ir a /account/settings, hacer clic en "Descargar mis datos". Debe descargarse un JSON con el usuario, pedidos y carrito. No debe incluir password ni refreshTokenHash.
□ Eliminación GDPR:
Intentar eliminar la cuenta con contraseña incorrecta → error.
Eliminar con contraseña correcta → debe redirigir al home.
Verificar en MongoDB que el usuario tiene email deleted_...@anon.local y que sus pedidos tienen shippingAddress.name: 'Deleted' pero conservan el total.
Intentar hacer login con la cuenta eliminada → debe fallar.
□ Cookie Consent: Abrir la página en incógnito. El banner de cookies debe aparecer. Sentry (o la herramienta de analítica) no debe cargarse hasta hacer clic en "Aceptar todo".
□ CSP (Helmet): Ir a securityheaders.com y escanear la URL de staging o producción. La calificación debe ser A. El Checkout de Stripe debe cargar sin errores de CSP en la consola.
□ Rate Limit: Hacer 6 intentos de checkout en menos de 10 minutos. El 6º debe devolver 429 Too Many Requests.
□ Dependabot: Hacer un push. El CI debe ejecutar npm audit. Si hay una vulnerabilidad de nivel "High", el workflow debe fallar (romper el build).
