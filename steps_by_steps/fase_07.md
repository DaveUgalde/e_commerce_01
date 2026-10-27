Fase 7 Granular: Cumplimiento Legal y Seguridad Avanzada

Esta fase cierra las brechas que impiden vender legalmente en la UE/LatAm y blinda el panel de administración. Al terminarla, tendrás T&C, cookies gestionadas, impuestos automáticos, admins con 2FA, headers de seguridad en nota A y rate limiting que no se evade rotando IPs.

#	Componente	Bloqueante legal	Resultado
1	Páginas legales (T&C, Privacidad, Cookies, Devoluciones)	✅	Cumples información precontractual
2	Cookie consent (GDPR / ePrivacy)	✅	Banner real, preferencias persistidas
3	Stripe Tax	✅	IVA/sales tax calculado automáticamente
4	2FA para admins (TOTP)	🟡	Admin con contraseña filtrada no es suficiente
5	CSP + Helmet afinado	🟡	Nota A en securityheaders.com
6	Rate limiting por usuario + Redis	🟡	No se evade rotando IPs
7	Escaneo de dependencias	🟡	CI falla con vulnerabilidades high/critical
📦 7.0 Dependencias

Backend:

bash
cd server

# 2FA
npm install speakeasy qrcode

# Rate limiting distribuido
npm install rate-limit-redis

# Stripe Tax (ya tienes stripe, pero por si acaso)
npm install stripe
Frontend:

bash
cd client
npm install vanilla-cookieconsent
Añade a server/.env.example:

env
# ─── Stripe Tax ──────────────────────────────────────────
STRIPE_AUTOMATIC_TAX=true
STRIPE_TAX_CODE=txcd_99999999   # General - Tangible goods

# ─── 2FA ─────────────────────────────────────────────────
TOTP_ISSUER=e_commerce_01
TOTP_WINDOW=1                   # ±30s tolerancia

# ─── Rate limiting distribuido ───────────────────────────
RATE_LIMIT_REDIS_PREFIX=rl:
📜 7.1 Páginas Legales Obligatorias

7.1.1 Qué textos necesitas (y por qué)

Página	Ruta	Contenido mínimo
Términos y Condiciones	/legal/terms	Uso del servicio, cuenta, precios, responsabilidad, ley aplicable
Política de Privacidad	/legal/privacy	Qué datos recoges, finalidad, base legal, retención, destinatarios (Stripe, SMTP), derechos
Política de Cookies	/legal/cookies	Tipos de cookies (técnicas, analíticas, marketing), finalidad, duración
Política de Devoluciones	/legal/returns	Plazo de desistimiento (14 días UE), condiciones, proceso
Aviso Legal	/legal/notice	Nombre fiscal, NIF/CIF, domicilio, email de contacto
⚠️ No inventes los textos. Usa un generador (TermsFeed, Iubenda) o consulta a un abogado. Son documentos legales con consecuencias reales.
7.1.2 Añadir aceptación de T&C al registro

Modelo User — añade campos:

javascript
// server/src/models/User.js
acceptedTermsAt: { type: Date, required: true },
termsVersion: { type: String, default: '1.0' },
Servicio de registro — modifica registerUser:

javascript
// server/src/services/auth.service.js
export async function registerUser({ name, email, password, acceptedTerms }) {
  if (!acceptedTerms) {
    throw new AppError('Debes aceptar los términos y la política de privacidad', 400);
  }
  // ...resto igual...
  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    acceptedTermsAt: new Date(),
    termsVersion: '1.0',
  });
  // ...
}
Validador en ruta:

javascript
// server/src/routes/auth.routes.js
body('acceptedTerms')
  .isBoolean().withMessage('Debes aceptar los términos')
  .custom((v) => v === true).withMessage('Debes aceptar los términos'),
Frontend RegisterPage — añade checkbox:

jsx
<label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16 }}>
  <input
    type="checkbox"
    checked={acceptedTerms}
    onChange={(e) => setAcceptedTerms(e.target.checked)}
    required
  />
  <span style={{ fontSize: 'var(--text-sm)' }}>
    Acepto los <Link to="/legal/terms" target="_blank">Términos y Condiciones</Link> y la{' '}
    <Link to="/legal/privacy" target="_blank">Política de Privacidad</Link>.
  </span>
</label>
7.1.3 Crear páginas legales en el frontend

Crea client/src/pages/legal/LegalPage.jsx como plantilla:

jsx
// client/src/pages/legal/LegalPage.jsx
export default function LegalPage({ title, children }) {
  return (
    <article style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1>{title}</h1>
      <div className="legal-content" style={{ lineHeight: 1.7 }}>
        {children}
      </div>
      <p style={{ marginTop: 'var(--space-8)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
        Última actualización: {new Date().toLocaleDateString('es-ES')}
      </p>
    </article>
  );
}
Crea las rutas en App.jsx:

jsx
const TermsPage = lazy(() => import('./pages/legal/TermsPage.jsx'));
const PrivacyPage = lazy(() => import('./pages/legal/PrivacyPage.jsx'));
const CookiesPage = lazy(() => import('./pages/legal/CookiesPage.jsx'));
const ReturnsPage = lazy(() => import('./pages/legal/ReturnsPage.jsx'));

<Route path="/legal/terms" element={<TermsPage />} />
<Route path="/legal/privacy" element={<PrivacyPage />} />
<Route path="/legal/cookies" element={<CookiesPage />} />
<Route path="/legal/returns" element={<ReturnsPage />} />
Y en el footer del Layout:

jsx
<footer style={{ borderTop: '1px solid var(--color-border)', padding: 'var(--space-6) 0', marginTop: 'var(--space-12)' }}>
  <div className="container" style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
    <Link to="/legal/terms">Términos</Link>
    <Link to="/legal/privacy">Privacidad</Link>
    <Link to="/legal/cookies">Cookies</Link>
    <Link to="/legal/returns">Devoluciones</Link>
    <button onClick={openCookiePreferences} className="btn btn--ghost btn--sm">
      Cambiar preferencias de cookies
    </button>
  </div>
</footer>
✅ Checklist 7.1:

□ Las 4-5 páginas legales existen y se enlazan en el footer.
□ El registro exige acceptedTerms: true.
□ User.acceptedTermsAt se guarda con timestamp.
□ termsVersion permite rastrear qué versión aceptó cada usuario.
🍪 7.2 Cookie Consent (GDPR / ePrivacy)

7.2.1 Categorizar tus cookies

Categoría	Ejemplos en e_commerce_01	¿Requiere consentimiento?
Estrictamente necesarias	refreshToken (httpOnly, sesión)	❌ No (exentas)
Analíticas	Sentry (si lo usas), Google Analytics	✅ Sí (opt-in)
Marketing	Píxeles de Stripe (si los añades)	✅ Sí (opt-in)
El refreshToken es una cookie técnica necesaria para el servicio. No requiere consentimiento, pero debes informar de ella en la Política de Cookies.
7.2.2 Implementar vanilla-cookieconsent

Crea client/src/components/CookieConsent.jsx:

jsx
// client/src/components/CookieConsent.jsx
import { useEffect } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';

export default function CookieConsentBanner() {
  useEffect(() => {
    CookieConsent.run({
      categories: {
        necessary: {
          enabled: true,
          readOnly: true,
        },
        analytics: {
          enabled: false,
          autoClear: {
            cookies: [{ name: /^_ga/ }, { name: '_gid' }],
          },
        },
      },
      language: {
        default: 'es',
        translations: {
          es: {
            consentModal: {
              title: 'Valoramos tu privacidad',
              description:
                'Usamos cookies para que la tienda funcione y, si lo aceptas, para analizar cómo la usas.',
              acceptAllBtn: 'Aceptar todo',
              acceptNecessaryBtn: 'Solo necesarias',
              showPreferencesBtn: 'Preferencias',
            },
            preferencesModal: {
              title: 'Preferencias de cookies',
              acceptAllBtn: 'Aceptar todo',
              acceptNecessaryBtn: 'Solo necesarias',
              savePreferencesBtn: 'Guardar preferencias',
              sections: [
                {
                  title: 'Cookies estrictamente necesarias',
                  description: 'Necesarias para el funcionamiento de la tienda (sesión, carrito).',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Cookies analíticas',
                  description: 'Nos ayudan a mejorar la tienda midiendo el uso de forma anónima.',
                  linkedCategory: 'analytics',
                },
              ],
            },
          },
        },
      },
      onConsent: ({ cookie }) => {
        // Inicializar Sentry / analytics solo si aceptaron
        if (CookieConsent.acceptedCategory('analytics')) {
          window.dispatchEvent(new CustomEvent('cookies:analytics-accepted'));
        }
      },
      onChange: ({ cookie }) => {
        if (CookieConsent.acceptedCategory('analytics')) {
          window.dispatchEvent(new CustomEvent('cookies:analytics-accepted'));
        }
      },
    });
  }, []);

  return null;
}
7.2.3 Condicionar Sentry al consentimiento

En client/src/instrument.js, en lugar de inicializar Sentry directamente, espera el evento:

javascript
// client/src/instrument.js
import * as Sentry from '@sentry/react';

function initSentry() {
  if (Sentry.getClient()) return; // ya inicializado
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    tracesSampleRate: 0.1,
  });
}

// Si ya aceptó previamente, inicializar de inmediato
if (localStorage.getItem('cc_cookie')) {
  try {
    const consent = JSON.parse(localStorage.getItem('cc_cookie'));
    if (consent.categories?.includes('analytics')) {
      initSentry();
    }
  } catch { /* ignore */ }
}

// Si acepta después del banner, inicializar
window.addEventListener('cookies:analytics-accepted', initSentry);
💡 Ajusta la clave cc_cookie según la que use vanilla-cookieconsent en tu versión. La librería guarda el consentimiento en localStorage con una clave configurable.
7.2.4 Añadir el componente al App.jsx

jsx
import CookieConsentBanner from './components/CookieConsent.jsx';

// Dentro del árbol, fuera del Router o dentro de él:
<CookieConsentBanner />
✅ Checklist 7.2:

□ Banner aparece en primera visita.
□ "Solo necesarias" no rompe la app.
□ La preferencia se guarda y no vuelve a aparecer.
□ Sentry solo se inicializa si aceptaron "analíticas".
□ "Cambiar preferencias" en el footer reabre el modal.
💰 7.3 Stripe Tax (Impuestos Automáticos)

7.3.1 Activar Stripe Tax en el Dashboard

Ve a dashboard.stripe.com/tax.
Añade registrations en cada jurisdicción donde tengas obligación fiscal (país/estado).
Configura un tax code por defecto (ej. txcd_99999999 para bienes tangibles).
Importante: Stripe Tax solo cobra en jurisdicciones donde hayas creado una registration. Si no la creas, Stripe calcula 0% de impuesto aunque el cliente esté en un país con IVA.
7.3.2 Añadir automatic_tax al Checkout Session

En server/src/services/order.service.js, dentro de checkout, al crear la sesión de Stripe:

javascript
// server/src/services/order.service.js
const stripeSession = await stripe.checkout.sessions.create({
  mode: 'payment',
  payment_method_types: ['card'],
  line_items: lineItems,
  success_url: process.env.STRIPE_SUCCESS_URL,
  cancel_url: process.env.STRIPE_CANCEL_URL,
  client_reference_id: order._id.toString(),
  metadata: { orderId: order._id.toString(), userId: userId.toString() },

  // ─── Stripe Tax ──────────────────────────────────────
  automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },

  // Necesario para calcular tax en la dirección de envío
  billing_address_collection: 'required',
  shipping_address_collection: {
    allowed_countries: ['US', 'ES', 'MX', 'AR', 'CO', 'CL', 'PE'],
  },

  // Guarda el Customer para futuras compras
  customer_creation: 'always',
  customer_update: { address: 'auto' },
});
Y en cada line_item, especifica el tax_code:

javascript
const lineItems = orderItems.map((it) => ({
  price_data: {
    currency: 'usd',
    product_data: {
      name: it.name,
      tax_code: process.env.STRIPE_TAX_CODE || 'txcd_99999999',
    },
    unit_amount: Math.round(it.priceAtPurchase * 100),
  },
  quantity: it.quantity,
}));
7.3.3 Actualizar el modelo Order para guardar impuestos

Añade campos al schema:

javascript
// server/src/models/Order.js
subtotal: { type: Number, required: true },
taxAmount: { type: Number, default: 0 },
shippingAmount: { type: Number, default: 0 },
total: { type: Number, required: true }, // ahora es subtotal + tax + shipping
En el webhook checkout.session.completed, Stripe te da total_details.amount_tax. Actualízalo:

javascript
// server/src/services/webhook.service.js — dentro de handleCheckoutCompleted
order.taxAmount = (session.total_details?.amount_tax || 0) / 100;
order.total = (session.amount_total || 0) / 100;
await order.save();
✅ Checklist 7.3:

□ Stripe Tax activado en dashboard con al menos una registration.
□ automatic_tax: { enabled: true } en la sesión.
□ El Checkout de Stripe muestra "Tax" con el importe calculado.
□ La orden guarda taxAmount y total desglosado.
□ Los emails muestran subtotal + impuesto = total.
🔐 7.4 2FA para Administradores (TOTP)

7.4.1 Modelo User — campos de 2FA

javascript
// server/src/models/User.js
twoFactorEnabled: { type: Boolean, default: false },
twoFactorSecret: { type: String, select: false }, // Base32, nunca exponer
twoFactorBackupCodes: { type: [String], select: false }, // hasheados
7.4.2 Servicio de 2FA (server/src/services/twoFactor.service.js)

javascript
// server/src/services/twoFactor.service.js
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const ISSUER = process.env.TOTP_ISSUER || 'e_commerce_01';
const WINDOW = Number(process.env.TOTP_WINDOW) || 1;

/**
 * Genera un secreto TOTP y un QR para que el usuario lo escanee.
 * NO activa 2FA todavía; se activa tras verificar el primer código.
 */
export async function generateTwoFactorSetup(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError('Usuario no encontrado', 404);
  if (user.twoFactorEnabled) throw new AppError('2FA ya está activado', 400);

  const secret = speakeasy.generateSecret({
    name: `${ISSUER} (${user.email})`,
    issuer: ISSUER,
    length: 32,
  });

  user.twoFactorSecret = secret.base32;
  await user.save();

  const qrCode = await QRCode.toDataURL(secret.otpauth_url);

  return { qrCode, secret: secret.base32 }; // secret para entrada manual
}

/**
 * Verifica el primer código y activa 2FA. Devuelve 10 códigos de recuperación.
 */
export async function confirmTwoFactorSetup(userId, code) {
  const user = await User.findById(userId).select('+twoFactorSecret');
  if (!user) throw new AppError('Usuario no encontrado', 404);
  if (user.twoFactorEnabled) throw new AppError('2FA ya activo', 400);
  if (!user.twoFactorSecret) throw new AppError('Primero genera el secreto', 400);

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code,
    window: WINDOW,
  });
  if (!valid) throw new AppError('Código inválido', 401);

  // Generar 10 códigos de recuperación
  const rawCodes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );
  const hashedCodes = await Promise.all(rawCodes.map((c) => bcrypt.hash(c, 10)));

  user.twoFactorEnabled = true;
  user.twoFactorBackupCodes = hashedCodes;
  await user.save();

  return { backupCodes: rawCodes }; // mostrar al usuario UNA sola vez
}

/**
 * Verifica un código TOTP o de recuperación durante el login.
 */
export async function verifyTwoFactor(userId, code) {
  const user = await User.findById(userId).select('+twoFactorSecret +twoFactorBackupCodes');
  if (!user || !user.twoFactorEnabled) throw new AppError('2FA no activo', 400);

  // 1. Intentar TOTP
  const totpValid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code,
    window: WINDOW,
  });
  if (totpValid) return true;

  // 2. Intentar código de recuperación
  for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
    const match = await bcrypt.compare(code.toUpperCase(), user.twoFactorBackupCodes[i]);
    if (match) {
      // Código de un solo uso: eliminarlo
      user.twoFactorBackupCodes.splice(i, 1);
      await user.save();
      return true;
    }
  }

  throw new AppError('Código 2FA inválido', 401);
}

/**
 * Desactiva 2FA (requiere contraseña actual).
 */
export async function disableTwoFactor(userId, password) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError('Usuario no encontrado', 404);

  const ok = await user.comparePassword(password);
  if (!ok) throw new AppError('Contraseña incorrecta', 401);

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorBackupCodes = undefined;
  await user.save();
}
7.4.3 Integrar 2FA en el login

El flujo cambia: si el usuario tiene 2FA, el login devuelve { requires2FA: true, tempToken } en lugar de los tokens finales.

Controlador de login:

javascript
// server/src/controllers/auth.controller.js
import { verifyTwoFactor } from '../services/twoFactor.service.js';
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.loginUser({ email, password });

    // Si tiene 2FA, NO devolver tokens finales todavía
    if (user.twoFactorEnabled) {
      const tempToken = signAccessToken({ id: user._id.toString(), role: user.role, temp2fa: true });
      return res.status(200).json({
        status: 'success',
        data: { requires2FA: true, tempToken },
      });
    }

    setRefreshCookie(res, refreshToken);
    res.status(200).json({
      status: 'success',
      data: { user: user.toJSON(), token: accessToken },
    });
  } catch (err) { next(err); }
}

export async function verify2FA(req, res, next) {
  try {
    const { tempToken, code } = req.body;
    const decoded = verifyAccessToken(tempToken);

    if (!decoded.temp2fa) throw new AppError('Token inválido para 2FA', 401);

    await verifyTwoFactor(decoded.id, code);

    const user = await authService.getUserById(decoded.id);
    const { accessToken, refreshToken } = await authService.issueTokensForUser(user);

    setRefreshCookie(res, refreshToken);
    res.json({
      status: 'success',
      data: { user: user.toJSON(), token: accessToken },
    });
  } catch (err) { next(err); }
}
Rutas:

javascript
router.post('/login', authLimiter, loginValidators, validate, authController.login);
router.post('/2fa/verify', authLimiter, authController.verify2FA);

// Setup de 2FA (solo admins)
router.post('/2fa/setup', protect, admin, authController.setup2FA);
router.post('/2fa/confirm', protect, admin, authController.confirm2FA);
7.4.4 Frontend — flujo de login con 2FA

LoginPage — tras login() exitoso:

jsx
const result = await login(email, password);

if (result.requires2FA) {
  // Guardar tempToken en state y mostrar formulario de código
  setTwoFactor({ tempToken: result.tempToken });
  return;
}
navigate(from);
Formulario de código 2FA (modal o inline):

jsx
{twoFactor && (
  <form onSubmit={handleVerify2FA}>
    <h2>Verificación en dos pasos</h2>
    <p>Introduce el código de 6 dígitos de tu app autenticadora.</p>
    <FormField
      id="code" label="Código" inputMode="numeric"
      value={code} onChange={(e) => setCode(e.target.value)}
      maxLength={6}
    />
    {error && <Alert variant="error">{error}</Alert>}
    <Button type="submit" fullWidth>Verificar</Button>
  </form>
)}
7.4.5 Página de seguridad para admin (/admin/security)

jsx
// client/src/pages/admin/AdminSecurityPage.jsx
import { useState, useEffect } from 'react';
import api from '../../services/api.js';
import Button from '../../components/Button.jsx';
import Alert from '../../components/Alert.jsx';
import { useAuth } from '../../hooks/useAuth.js';

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [error, setError] = useState(null);

  async function startSetup() {
    try {
      const { data } = await api.post('/auth/2fa/setup');
      setSetup(data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error');
    }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    try {
      const { data } = await api.post('/auth/2fa/confirm', { code });
      setBackupCodes(data.data.backupCodes);
      setSetup(null);
      setCode('');
    } catch (err) {
      setError(err.response?.data?.message || 'Código inválido');
    }
  }

  if (backupCodes) {
    return (
      <div>
        <h1>2FA activado</h1>
        <Alert variant="success">Guarda estos códigos de recuperación. No se mostrarán de nuevo.</Alert>
        <pre style={{ background: 'var(--color-bg-muted)', padding: 16, borderRadius: 8 }}>
          {backupCodes.join('\n')}
        </pre>
        <Button onClick={() => window.location.reload()}>Entendido</Button>
      </div>
    );
  }

  if (setup) {
    return (
      <div style={{ maxWidth: 400 }}>
        <h1>Escanear QR</h1>
        <img src={setup.qrCode} alt="QR 2FA" style={{ width: '100%' }} />
        <p>O introduce manualmente: <code>{setup.secret}</code></p>
        <form onSubmit={confirmSetup}>
          <input
            value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="Código de 6 dígitos" maxLength={6}
            className="field__input" style={{ width: '100%', marginBottom: 12 }}
          />
          {error && <Alert variant="error">{error}</Alert>}
          <Button type="submit" fullWidth>Confirmar y activar</Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h1>Seguridad</h1>
      <p>Estado 2FA: <strong>{user?.twoFactorEnabled ? 'Activado' : 'Desactivado'}</strong></p>
      {!user?.twoFactorEnabled && (
        <Button onClick={startSetup}>Activar 2FA</Button>
      )}
    </div>
  );
}
✅ Checklist 7.4:

□ Admin puede activar 2FA desde /admin/security.
□ El QR funciona con Google Authenticator / Authy.
□ Login sin código TOTP → no emite tokens finales.
□ Los 10 códigos de recuperación funcionan una vez cada uno.
□ twoFactorSecret nunca aparece en respuestas de API (select: false).
□ Recomendado: forzar 2FA a todo admin en el primer login (middleware que detecte role === 'admin' && !twoFactorEnabled y bloquee rutas admin excepto /admin/security).
🛡️ 7.5 CSP + Helmet Afinado

7.5.1 Directivas CSP para Stripe

Basado en la documentación de Stripe y ejemplos de la comunidad, las directivas mínimas son:

javascript
// server/src/app.js — reemplaza el helmet() actual
import helmet from 'helmet';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://js.stripe.com',
          // 'unsafe-inline' solo si el build de Vite lo requiere (idealmente evitar)
        ],
        styleSrc: ["'self'", "'unsafe-inline'"], // necesario para estilos dinámicos de React
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: [
          "'self'",
          'https://api.stripe.com',
          'https://*.stripe.com',
          'https://*.sentry.io', // si usas Sentry
        ],
        frameSrc: [
          'https://js.stripe.com',
          'https://checkout.stripe.com',
          'https://hooks.stripe.com',
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 año
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false, // Stripe Checkout lo requiere desactivado
  })
);
7.5.2 Verificar con securityheaders.com

Despliega a staging/producción.
Ve a securityheaders.com e introduce tu dominio.
Objetivo: nota A. Si falta algo, la web te dice qué header añadir.
✅ Checklist 7.5:

□ securityheaders.com → nota A o superior.
□ Stripe Checkout carga sin errores de CSP en consola.
□ Sentry recibe eventos (si lo usas) sin violaciones CSP.
□ HSTS con preload activo.
🚦 7.6 Rate Limiting por Usuario + Redis

7.6.1 Instalar el store de Redis

bash
npm install rate-limit-redis
Asegúrate de tener redis exportado desde server/src/config/redis.js (lo creaste en Fase 6).

7.6.2 Configurar limiters con clave por usuario

Crea server/src/middlewares/rateLimit.middleware.js:

javascript
// server/src/middlewares/rateLimit.middleware.js
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';

// ─── Limiter global (por usuario o IP) ───────────────────
export const apiLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:api:',
  }),
  windowMs: 15 * 60 * 1000,
  max: 300, // 300 req / 15 min
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

// ─── Limiter estricto para auth ──────────────────────────
export const authLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:auth:',
  }),
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true, // no contar logins exitosos
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combinar IP + email para evitar ataques distribuidos contra una cuenta
    const email = req.body?.email?.toLowerCase().trim() || '';
    return `${req.ip}:${email}`;
  },
});

// ─── Limiter para checkout ───────────────────────────────
export const checkoutLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:checkout:',
  }),
  windowMs: 10 * 60 * 1000,
  max: 5, // 5 intentos de checkout / 10 min / usuario
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});
7.6.3 Aplicar los limiters

javascript
// server/src/app.js
import { apiLimiter } from './middlewares/rateLimit.middleware.js';
app.use('/api', apiLimiter); // reemplaza el limiter global anterior

// server/src/routes/auth.routes.js
import { authLimiter } from '../middlewares/rateLimit.middleware.js';
router.post('/login', authLimiter, ...);
router.post('/register', authLimiter, ...);

// server/src/routes/order.routes.js
import { checkoutLimiter } from '../middlewares/rateLimit.middleware.js';
router.post('/checkout', protect, checkoutLimiter, ...);
Por qué el keyGenerator por usuario es clave: con IP solo, un atacante con proxies rota IPs y evade el límite. Con user._id, cada cuenta tiene su propia cuota, sin importar desde dónde ataque.

✅ Checklist 7.6:

□ Login con 11 intentos fallidos desde la misma cuenta → 429.
□ El rate limit sobrevive a un restart del server (Redis).
□ Checkout tiene límite propio (5 intentos / 10 min / usuario).
□ Un usuario autenticado y otro desde la misma IP tienen cuotas separadas.
📦 7.7 Escaneo de Dependencias

7.7.1 Dependabot (.github/dependabot.yml)

yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /server
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
    groups:
      server-minor-patch:
        patterns: ['*']
        update-types: ['minor', 'patch']

  - package-ecosystem: npm
    directory: /client
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
    groups:
      client-minor-patch:
        patterns: ['*']
        update-types: ['minor', 'patch']

  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
7.7.2 Añadir npm audit al CI

En .github/workflows/ci.yml, añade un job o un step:

yaml
      - name: Security audit
        working-directory: server
        run: npm audit --audit-level=high
      - name: Security audit (client)
        working-directory: client
        run: npm audit --audit-level=high
--audit-level=high hace que el CI falle solo con vulnerabilidades high o critical. Las moderate/low no bloquean el build, pero Dependabot las va parcheando vía PRs.
✅ Checklist 7.7:

□ Dependabot activo (aparecen PRs de actualización).
□ El CI falla si npm audit --audit-level=high encuentra algo.
□ El equipo revisa PRs de Dependabot semanalmente (o auto-merge para patch si los tests pasan).
✅ 7.8 Checklist Global de la Fase 7

Legal

□ T&C, Privacidad, Cookies, Devoluciones existen y se enlazan.
□ Registro exige aceptar T&C; se guarda acceptedTermsAt y termsVersion.
□ Cookie consent con "Solo necesarias" funcional.
□ Sentry solo se inicializa si aceptaron analíticas.
Impuestos

□ Stripe Tax activo con al menos una registration.
□ Checkout muestra "Tax" desglosado.
□ Order.taxAmount guardado desde el webhook.
2FA

□ Admin puede activar 2FA con QR.
□ Login de admin requiere código TOTP.
□ Códigos de recuperación funcionan una vez.
□ twoFactorSecret nunca se expone en API.
Seguridad HTTP

□ securityheaders.com → nota A.
□ Stripe Checkout no rompe por CSP.
Rate limiting

□ Limiter por user._id (no solo IP).
□ Redis store compartido entre instancias.
□ Checkout con límite propio (5/10min).
Dependencias

□ Dependabot activo.
□ CI falla con npm audit --audit-level=high.
Commit

bash
git add .
git commit -m "feat(security): phase 7 — legal compliance and advanced security

- Legal pages (terms, privacy, cookies, returns) with T&C acceptance on register
- GDPR cookie consent with vanilla-cookieconsent (analytics opt-in)
- Stripe Tax with automatic_tax + tax codes
- TOTP 2FA for admins with backup recovery codes
- CSP fine-tuned for Stripe (Helmet) — securityheaders.com grade A
- Redis-backed rate limiting keyed by user ID + email
- Dependabot + npm audit --audit-level=high in CI"
📊 Resumen Visual de la Fase 7

text
┌──────────────────────────────────────────────────────────────┐
│                  LEGAL + SEGURIDAD AVANZADA                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  Legal       │     │  Cookie      │     │  Stripe Tax │  │
│  │  T&C + P.P.  │     │  Consent     │     │  automatic  │  │
│  └──────┬───────┘     └──────┬───────┘     └──────┬──────┘  │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Registro + Checkout                     │   │
│  │   (acceptedTermsAt, taxAmount, total desglosado)     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  Admin 2FA   │     │  CSP + HSTS  │     │  Rate limit │  │
│  │  TOTP + QR   │     │  nota A      │     │  por user   │  │
│  └──────────────┘     └──────────────┘     └──────┬──────┘  │
│                                                    │         │
│                                                    ▼         │
│                                          ┌──────────────┐   │
│                                          │    Redis     │   │
│                                          │  (cuotas)    │   │
│                                          └──────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Dependabot + npm audit --audit-level=high en CI     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
