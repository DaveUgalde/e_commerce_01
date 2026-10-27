Fase 5 Granular: Preparación para Producción Real

Esta fase convierte e_commerce_01 de un proyecto funcional en un producto listo para producción: pago real con Stripe, autenticación con refresh tokens, recuperación de contraseña, emails transaccionales, observabilidad estructurada y CI/CD automatizado.

Lo que construiremos:

#	Módulo	Por qué es crítico
1	Stripe + webhooks	Sin pago real, no hay negocio. El webhook es la fuente de verdad.
2	Refresh tokens	Access token 15min + refresh rotado = sesión segura sin re-login.
3	Password recovery	El 30% de los usuarios olvida su contraseña.
4	Emails transaccionales	Bienvenida, confirmación de pedido, reset password.
5	Observabilidad	Logs estructurados con pino + correlation ID.
6	CI/CD con GitHub Actions	Cada push a main = test + build + deploy.
📦 5.0 Dependencias y Variables de Entorno

5.0.1 Instalación

bash
cd server
npm install stripe nodemailer pino pino-http cookie-parser
5.0.2 Ampliar server/.env.example

env
# ─── JWT (nuevo modelo) ──────────────────────────────────
JWT_SECRET=change_this_in_production_min_32_chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_REFRESH_SECRET=another_secret_also_32_chars_minimum

# ─── Stripe ──────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=http://localhost:5173/orders/success?session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=http://localhost:5173/cart

# ─── Email ───────────────────────────────────────────────
EMAIL_HOST=smtp.ethereal.email
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM="e_commerce_01 <no-reply@e_commerce_01.com>"

# ─── Frontend origin (para links en emails) ──────────────
FRONTEND_URL=http://localhost:5173

# ─── Observabilidad ──────────────────────────────────────
LOG_LEVEL=info
Actualiza también server/src/utils/jwt.js para manejar dos tipos de tokens (cubierto en 5.2).

💳 5.1 Stripe: Pago Real y Webhooks

Concepto clave: el backend nunca debe marcar una orden como paid porque el frontend diga "listo". La única fuente de verdad es el webhook firmado de Stripe. Esto previene fraude por manipulación del cliente.

Flujo completo

text
1. Cliente → POST /api/orders/checkout
              ↓
2. Backend: reserva stock + crea Order(status: 'pending')
              ↓
3. Backend → stripe.checkout.sessions.create({ metadata: { orderId } })
              ↓
4. Backend devuelve { checkoutUrl, sessionId } al cliente
              ↓
5. Cliente → redirect a Stripe Checkout (dominio de Stripe)
              ↓
6. Cliente paga
              ↓
7. Stripe → POST /api/webhooks/stripe (checkout.session.completed)
              ↓
8. Webhook: verifica firma, marca Order → 'paid'
              ↓
9. Stripe redirige al cliente a STRIPE_SUCCESS_URL
              ↓
10. Frontend polling → /api/orders/:id hasta ver status === 'paid'
# Paso 5.1.1: Instancia de Stripe (server/src/config/stripe.js)

javascript
// server/src/config/stripe.js
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY no está definido');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  typescript: false,
});
# Paso 5.1.2: Refactorizar checkout en order.service.js

Reemplaza la función checkout completa. Ahora el checkout no marca paid: crea la orden en pending y devuelve una Stripe Checkout Session.

javascript
// server/src/services/order.service.js
import { stripe } from '../config/stripe.js';

/**
 * Crea la orden en 'pending' y devuelve una URL de Stripe Checkout.
 * El stock YA se reserva (decrementa) aquí; si el pago falla,
 * el webhook `checkout.session.expired` hará el rollback.
 */
export async function checkout(userId, shippingAddress) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cart = await Cart.findOne({ user: userId })
      .populate('items.product')
      .session(session);

    if (!cart || cart.items.length === 0) {
      throw new AppError('El carrito está vacío', 400);
    }

    const orderItems = [];

    for (const item of cart.items) {
      const product = item.product;
      if (!product || !product.isActive) {
        throw new AppError(`Producto no disponible`, 409);
      }

      const updated = await Product.findOneAndUpdate(
        { _id: product._id, stock: { $gte: item.quantity }, isActive: true },
        { $inc: { stock: -item.quantity } },
        { new: true, session }
      );
      if (!updated) {
        throw new AppError(`Stock insuficiente para "${product.name}"`, 409);
      }

      orderItems.push({
        product: product._id,
        name: product.name,
        priceAtPurchase: product.price,
        quantity: item.quantity,
      });
    }

    const total = orderItems.reduce(
      (sum, it) => sum + it.priceAtPurchase * it.quantity, 0
    );

    const [order] = await Order.create(
      [{
        user: userId,
        items: orderItems,
        total,
        status: 'pending', // ⚠️ Stripe decidirá si pasa a 'paid'
        shippingAddress,
      }],
      { session }
    );

    cart.items = [];
    await cart.save({ session });

    await session.commitTransaction();

    // ─── Crear Stripe Checkout Session ────────────────────
    const lineItems = orderItems.map((it) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: it.name },
        unit_amount: Math.round(it.priceAtPurchase * 100), // centavos
      },
      quantity: it.quantity,
    }));

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: process.env.STRIPE_SUCCESS_URL,
      cancel_url: process.env.STRIPE_CANCEL_URL,
      client_reference_id: order._id.toString(),
      metadata: { orderId: order._id.toString(), userId: userId.toString() },
      // Guardamos el payment_intent para conciliar
      payment_intent_data: {
        metadata: { orderId: order._id.toString() },
      },
    });

    order.stripeSessionId = stripeSession.id;
    await order.save();

    return { order, checkoutUrl: stripeSession.url };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
Añade stripeSessionId al schema Order:

javascript
// server/src/models/Order.js — añade al schema
stripeSessionId: { type: String, index: true },
stripePaymentIntentId: { type: String, index: true },
# Paso 5.1.3: Servicio de webhooks (server/src/services/webhook.service.js)

javascript
// server/src/services/webhook.service.js
import { stripe } from '../config/stripe.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { AppError } from '../utils/AppError.js';
import { sendOrderConfirmation } from './email.service.js';
import logger from '../config/logger.js';

/**
 * Verifica la firma del webhook de Stripe.
 * Lanza AppError 400 si la firma es inválida.
 */
export function verifyStripeSignature(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new AppError('STRIPE_WEBHOOK_SECRET no configurado', 500);

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new AppError(`Firma de webhook inválida: ${err.message}`, 400);
  }
}

/**
 * Procesa un evento de Stripe. Idempotente: si el evento ya se procesó,
 * no hace nada (Stripe reintenta webhooks fallidos).
 */
export async function processStripeEvent(event) {
  logger.info({ eventId: event.id, type: event.type }, 'Stripe webhook recibido');

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object);

    case 'checkout.session.expired':
      return handleCheckoutExpired(event.data.object);

    case 'charge.refunded':
      return handleChargeRefunded(event.data.object);

    default:
      logger.debug({ type: event.type }, 'Evento no manejado');
      return { handled: false };
  }
}

/**
 * Pago completado: confirmar la orden y notificar por email.
 */
async function handleCheckoutCompleted(session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    logger.warn({ sessionId: session.id }, 'Webhook sin orderId en metadata');
    return { handled: false };
  }

  const order = await Order.findById(orderId).populate('user', 'name email');
  if (!order) {
    logger.warn({ orderId }, 'Orden no encontrada');
    return { handled: false };
  }

  // Idempotencia: si ya está pagada, salir
  if (order.status !== 'pending') {
    logger.info({ orderId, status: order.status }, 'Orden ya procesada, skip');
    return { handled: true, order };
  }

  order.status = 'paid';
  order.stripePaymentIntentId = session.payment_intent;
  await order.save();

  // Email de confirmación (no bloqueante: si falla, se loguea pero no rompe el webhook)
  sendOrderConfirmation(order).catch((err) => {
    logger.error({ err, orderId }, 'Error enviando email de confirmación');
  });

  return { handled: true, order };
}

/**
 * Sesión expirada (usuario cerró Stripe o no pagó en 24h).
 * Rollback: restaurar stock y cancelar la orden.
 */
async function handleCheckoutExpired(session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) return { handled: false };

  const order = await Order.findById(orderId);
  if (!order || order.status !== 'pending') return { handled: true };

  // Restaurar stock en transacción
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();
  try {
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity } },
        { session: dbSession }
      );
    }
    order.status = 'cancelled';
    await order.save({ session: dbSession });
    await dbSession.commitTransaction();
    logger.info({ orderId }, 'Orden expirada: stock restaurado');
  } catch (err) {
    await dbSession.abortTransaction();
    throw err;
  } finally {
    dbSession.endSession();
  }

  return { handled: true };
}

async function handleChargeRefunded(charge) {
  const orderId = charge.metadata?.orderId;
  if (!orderId) return { handled: false };

  const order = await Order.findById(orderId);
  if (!order) return { handled: false };

  order.status = 'cancelled';
  await order.save();
  logger.info({ orderId, chargeId: charge.id }, 'Reembolso procesado');
  return { handled: true };
}

import mongoose from 'mongoose';
# Paso 5.1.4: Ruta de webhook (server/src/routes/webhook.routes.js)

CRÍTICO: el webhook necesita el body crudo (Buffer), no JSON parseado. Debe montarse antes de express.json() en app.js.

javascript
// server/src/routes/webhook.routes.js
import { Router } from 'express';
import express from 'express';
import { verifyStripeSignature, processStripeEvent } from '../services/webhook.service.js';
import logger from '../config/logger.js';

const router = Router();

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }), // 🔑 body raw, NO json
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ status: 'error', message: 'Falta firma' });
    }

    let event;
    try {
      event = verifyStripeSignature(req.body, signature);
    } catch (err) {
      logger.warn({ err: err.message }, 'Firma inválida en webhook');
      return res.status(400).json({ status: 'error', message: err.message });
    }

    try {
      await processStripeEvent(event);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Error procesando webhook');
      // Devolver 500 hace que Stripe reintente en 24h
      res.status(500).json({ status: 'error' });
    }
  }
);

export default router;
# Paso 5.1.5: Montar webhook ANTES de express.json() en app.js

javascript
// server/src/app.js
import webhookRoutes from './routes/webhook.routes.js';

// ⚠️ EL WEBHOOK VA ANTES DE express.json()
app.use('/api/webhooks', webhookRoutes);

// ...luego el resto de middlewares (json, cors, etc.)
app.use(express.json({ limit: '10kb' }));
¿Por qué el orden importa? express.json() consume el stream y lo convierte en objeto. Stripe necesita el payload crudo exacto para verificar la firma HMAC. Si el JSON se reparsea, la firma no coincide.

# Paso 5.1.6: Endpoint de polling para el frontend

Cuando el usuario vuelve de Stripe, el frontend consulta /orders/:id hasta que status === 'paid'. Añade un endpoint ligero:

javascript
// server/src/controllers/order.controller.js
export async function getPaymentStatus(req, res, next) {
  try {
    const order = await orderService.getUserOrder(req.user._id, req.params.id);
    res.json({
      status: 'success',
      data: { status: order.status, total: order.total },
    });
  } catch (err) { next(err); }
}
javascript
// server/src/routes/order.routes.js — añade
router.get('/:id/status', orderController.getPaymentStatus);
# Paso 5.1.7: Frontend — CheckoutPage redirige a Stripe

Modifica el handleSubmit de CheckoutPage.jsx:

jsx
async function handleSubmit(e) {
  e.preventDefault();
  setSubmitting(true);
  setFieldErrors({});
  setGlobalError(null);

  try {
    const { data } = await api.post('/orders/checkout', { shippingAddress: form });
    // El backend ya vació el carrito; limpiamos local
    await clearCart();
    sessionStorage.removeItem(FORM_KEY);

    // Redirigir al Checkout de Stripe
    window.location.href = data.data.checkoutUrl;
  } catch (err) {
    const res = err.response?.data;
    if (res?.errors) {
      const fe = {};
      res.errors.forEach((er) => { fe[er.field.replace(/^shippingAddress\./, '')] = er.message; });
      setFieldErrors(fe);
    } else {
      setGlobalError(res?.message || 'Error procesando el pedido');
    }
    setSubmitting(false);
  }
}
Nota: el submitting no se resetea porque la página se va a desmontar al redirigir a Stripe. El botón queda deshabilitado intencionalmente.

# Paso 5.1.8: Frontend — nueva OrderSuccessPage

jsx
// client/src/pages/OrderSuccessPage.jsx
import { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import Alert from '../components/Alert.jsx';
import Button from '../components/Button.jsx';
import Skeleton from '../components/Skeleton.jsx';

export default function OrderSuccessPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = params.get('session_id');
  const [status, setStatus] = useState('checking');
  const [order, setOrder] = useState(null);

  useEffect(() => {
    if (!sessionId) return navigate('/', { replace: true });

    // El orderId viene en client_reference_id, pero no lo tenemos en la URL.
    // Estrategia: polling a /orders?session_id=... (endpoint nuevo) o usar /orders/me
    // Simplificamos: el backend expone GET /orders/by-session/:sessionId
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 × 1.5s = 30s

    async function poll() {
      try {
        const { data } = await api.get(`/orders/by-session/${sessionId}`);
        const o = data.data.order;
        setOrder(o);

        if (o.status === 'paid') {
          setStatus('paid');
          return;
        }
        if (o.status === 'cancelled') {
          setStatus('cancelled');
          return;
        }
        // pending: seguir poll
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          setStatus('timeout');
          return;
        }
        setTimeout(poll, 1500);
      } catch (err) {
        setStatus('error');
      }
    }
    poll();
  }, [sessionId, navigate]);

  if (status === 'checking') {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
        <Skeleton height={40} width="50%" style={{ margin: '0 auto' }} />
        <p style={{ marginTop: 'var(--space-4)', color: 'var(--color-text-muted)' }}>
          Confirmando tu pago con Stripe…
        </p>
      </div>
    );
  }

  if (status === 'cancelled') {
    return <Alert variant="warning">El pago fue cancelado. <Link to="/cart">Volver al carrito</Link></Alert>;
  }

  if (status === 'timeout') {
    return <Alert variant="warning">El pago aún se está confirmando. Revisa tu historial en unos minutos.</Alert>;
  }

  if (status === 'error' || !order) {
    return <Alert variant="error">No pudimos confirmar tu pedido. Contacta a soporte.</Alert>;
  }

  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-12) 0' }}>
      <div style={{ fontSize: 64 }}>✅</div>
      <h1>¡Pago exitoso!</h1>
      <p style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text-muted)' }}>
        Tu pedido <strong>#{order._id.slice(-8).toUpperCase()}</strong> ha sido confirmado.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-6)' }}>
        <Link to={`/orders/${order._id}`}><Button>Ver pedido</Button></Link>
        <Link to="/products"><Button variant="secondary">Seguir comprando</Button></Link>
      </div>
    </div>
  );
}
Añade el endpoint backend by-session:

javascript
// server/src/controllers/order.controller.js
export async function getBySession(req, res, next) {
  try {
    const Order = (await import('../models/Order.js')).default;
    const order = await Order.findOne({
      stripeSessionId: req.params.sessionId,
      user: req.user._id,
    });
    if (!order) return res.status(404).json({ status: 'error', message: 'No encontrado' });
    res.json({ status: 'success', data: { order } });
  } catch (err) { next(err); }
}
javascript
// server/src/routes/order.routes.js
router.get('/by-session/:sessionId', orderController.getBySession);
Añade la ruta en App.jsx:

jsx
<Route path="/orders/success" element={<ProtectedRoute><OrderSuccessPage /></ProtectedRoute>} />
# Paso 5.1.9: Probar con Stripe CLI

Instala el CLI:

bash
# macOS
brew install stripe/stripe-cli/stripe
# Linux/WSL
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install stripe
Login y forward de webhooks:

bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
Esto imprime algo como:

text
> Ready! Your webhook signing secret is whsec_abc123...
Copia ese whsec_... a tu .env en STRIPE_WEBHOOK_SECRET y reinicia el backend.

Obtén las claves de test:

bash
stripe config --list
# O ve al dashboard: https://dashboard.stripe.com/test/apikeys
Copia sk_test_... a STRIPE_SECRET_KEY.

Test card: 4242 4242 4242 4242, cualquier fecha futura, cualquier CVC.

Prueba el flujo completo:

npm run dev en server + client
Añade productos al carrito → checkout
Introduce la tarjeta 4242 4242 4242 4242
Tras pagar, Stripe redirige a /orders/success?session_id=...
El webhook llega al backend (visible en la terminal de stripe listen)
El frontend hace polling → ve paid
Recibes email de confirmación (en Ethereal, ver 5.4)
✅ Checklist Stripe:

□ Checkout redirige a checkout.stripe.com.
□ Pago exitoso → orden pasa a paid (verificar en Mongo).
□ stripe listen muestra el evento checkout.session.completed.
□ Sin el servidor de webhook activo, la orden queda pending indefinidamente (comportamiento correcto).
□ Tarjeta declinada (4000 0000 0000 0002) → Stripe la rechaza antes de nuestro webhook.
□ Al expirar la sesión (configurable en Stripe CLI con stripe trigger checkout.session.expired), el stock se restaura.
🔄 5.2 Refresh Tokens con Rotación

Problema del modelo actual: un JWT de 1h no se puede revocar. Si te roban el token, el atacante tiene 1h de acceso.

Solución: access token de 15min + refresh token de 7d en cookie httpOnly. Rotación en cada uso con detección de reuso (si un refresh viejo se usa, se invalida toda la sesión).

# Paso 5.2.1: Actualizar modelo User

Añade al schema:

javascript
// server/src/models/User.js — añade al schema
refreshTokenHash: {
  type: String,
  select: false,
},
refreshTokenExpiresAt: {
  type: Date,
  select: false,
},
# Paso 5.2.2: Reemplazar server/src/utils/jwt.js

javascript
// server/src/utils/jwt.js
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { AppError } from './AppError.js';

const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('JWT_SECRET y JWT_REFRESH_SECRET deben estar definidos');
}
if (ACCESS_SECRET.length < 32 || REFRESH_SECRET.length < 32) {
  throw new Error('Los secrets deben tener al menos 32 caracteres');
}

export function signAccessToken({ id, role }) {
  return jwt.sign({ id, role, type: 'access' }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES,
    issuer: 'e_commerce_01-api',
  });
}

export function signRefreshToken({ id }) {
  return jwt.sign({ id, type: 'refresh' }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES,
    issuer: 'e_commerce_01-api',
  });
}

export function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET, { issuer: 'e_commerce_01-api' });
    if (decoded.type !== 'access') throw new Error('Tipo de token inválido');
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new AppError('Token expirado', 401);
    throw new AppError('Token inválido', 401);
  }
}

export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET, { issuer: 'e_commerce_01-api' });
    if (decoded.type !== 'refresh') throw new Error('Tipo de token inválido');
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new AppError('Refresh token expirado', 401);
    throw new AppError('Refresh token inválido', 401);
  }
}

// ─── Hash de refresh tokens para almacenar en DB ──────────
// Guardamos el HASH, no el token: si la DB se filtra, no hay sesiones robables.
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Generar token de reset password ──────────────────────
export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}
# Paso 5.2.3: auth.service.js — emisión de refresh token

Actualiza registerUser y loginUser:

javascript
// server/src/services/auth.service.js
import { signAccessToken, signRefreshToken, hashToken } from '../utils/jwt.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

async function issueTokens(user) {
  const accessToken = signAccessToken({ id: user._id.toString(), role: user.role });
  const refreshToken = signRefreshToken({ id: user._id.toString() });

  user.refreshTokenHash = hashToken(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await user.save();

  return { accessToken, refreshToken };
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) throw new AppError('El email ya está registrado', 409);

  const user = await User.create({ name, email: normalizedEmail, password });
  const tokens = await issueTokens(user);

  return { user, ...tokens };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select('+password');
  if (!user) throw new AppError('Credenciales inválidas', 401);

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new AppError('Credenciales inválidas', 401);

  const tokens = await issueTokens(user);
  user.password = undefined;

  return { user, ...tokens };
}

/**
 * Rota el refresh token: verifica, invalida el viejo, emite uno nuevo.
 * Detecta REUSO: si un refresh ya rotado se usa otra vez, invalida toda la sesión.
 */
export async function refreshSession(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);
  const user = await User.findById(decoded.id).select('+refreshTokenHash +refreshTokenExpiresAt');
  if (!user) throw new AppError('Usuario no encontrado', 401);

  // Verificar que el hash coincide (defiende contra refresh robados y revocados)
  const incomingHash = hashToken(refreshToken);
  if (user.refreshTokenHash !== incomingHash) {
    // 🚨 REUSO DETECTADO: posible token robado. Invalidamos la sesión entera.
    user.refreshTokenHash = undefined;
    user.refreshTokenExpiresAt = undefined;
    await user.save();
    throw new AppError('Refresh token revocado. Inicia sesión de nuevo.', 401);
  }

  if (user.refreshTokenExpiresAt < new Date()) {
    throw new AppError('Refresh token expirado', 401);
  }

  // Rotar: nuevo par de tokens
  const tokens = await issueTokens(user);
  return { user, ...tokens };
}

export async function logoutUser(userId) {
  await User.findByIdAndUpdate(userId, {
    $unset: { refreshTokenHash: '', refreshTokenExpiresAt: '' },
  });
}
Añade import { verifyRefreshToken } arriba.

# Paso 5.2.4: Middleware protect usa verifyAccessToken

En server/src/middlewares/auth.middleware.js:

javascript
import { verifyAccessToken } from '../utils/jwt.js';

export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Token no proporcionado', 401);
    }
    const decoded = verifyAccessToken(header.split(' ')[1]);
    const user = await User.findById(decoded.id);
    if (!user) throw new AppError('Usuario no encontrado', 401);
    req.user = user;
    next();
  } catch (err) { next(err); }
}
# Paso 5.2.5: Cookies para el refresh token

En auth.controller.js, actualiza register, login, me, y añade refresh, logout:

javascript
import { AppError } from '../utils/AppError.js';
import * as authService from '../services/auth.service.js';

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,          // JS del navegador no puede leerla (anti-XSS)
  secure: process.env.NODE_ENV === 'production', // solo HTTPS en prod
  sameSite: 'strict',      // anti-CSRF
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',       // solo se envía a /api/auth/*
};

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, REFRESH_COOKIE_OPTS);
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTS, maxAge: 0 });
}

export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.registerUser({ name, email, password });
    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      status: 'success',
      data: { user: user.toJSON(), token: accessToken }, // 'token' = access
    });
  } catch (err) { next(err); }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.loginUser({ email, password });
    setRefreshCookie(res, refreshToken);
    res.status(200).json({
      status: 'success',
      data: { user: user.toJSON(), token: accessToken },
    });
  } catch (err) { next(err); }
}

export async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) throw new AppError('Sin refresh token', 401);
    const { user, accessToken, refreshToken: newRefresh } = await authService.refreshSession(refreshToken);
    setRefreshCookie(res, newRefresh);
    res.json({ status: 'success', data: { user: user.toJSON(), token: accessToken } });
  } catch (err) {
    clearRefreshCookie(res);
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    if (req.user) await authService.logoutUser(req.user._id);
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function getMe(req, res, next) {
  try {
    res.json({ status: 'success', data: { user: req.user.toJSON() } });
  } catch (err) { next(err); }
}
# Paso 5.2.6: Rutas de auth actualizadas

javascript
// server/src/routes/auth.routes.js
router.post('/register', authLimiter, registerValidators, validate, authController.register);
router.post('/login', authLimiter, loginValidators, validate, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getMe);
Y en app.js añade cookie-parser:

javascript
import cookieParser from 'cookie-parser';
app.use(cookieParser());
# Paso 5.2.7: Frontend — manejo automático de refresh

El interceptor 401 ahora intenta un refresh silencioso antes de redirigir a login:

javascript
// client/src/services/api.js — reemplaza el interceptor de respuesta
let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token = null) {
  failedQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token)));
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Solo refrescar si es 401, no es el propio /auth/refresh, y no reintentamos ya
    if (
      error.response?.status === 401 &&
      !original._retry &&
      original.url !== '/auth/refresh' &&
      localStorage.getItem('token')
    ) {
      if (isRefreshing) {
        // Encolar: el request espera a que termine el refresh en curso
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const { data } = await api.post('/auth/refresh', {}, { withCredentials: true });
        const newToken = data.data.token;
        localStorage.setItem('token', newToken);

        processQueue(null, newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('token');
        window.dispatchEvent(new CustomEvent('auth:expired'));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
Añade withCredentials: true en la config de axios.create:

javascript
const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // 🔑 permite enviar cookie de refresh
});
Añade /auth/refresh al proxy de Vite (ya funciona por /api) y asegúrate de que cors en el backend tenga credentials: true (ya lo tiene desde fase 0).

✅ Checklist refresh tokens:

□ Login → cookie refreshToken httpOnly (visible en DevTools pero no en document.cookie).
□ En localStorage: solo el access token.
□ Tras 15min, una petición con access expirado → refresh automático → reintenta la petición sin que el usuario note nada.
□ Logout → cookie borrada en backend + usuario sin sesión.
□ Test de reuso: en DevTools → Application → Cookies, copia el refresh token. Haz logout. Pega el token manualmente. Petición a /auth/refresh → 401 (reuso detectado). El usuario se desloguea.
🔑 5.3 Recuperación de Contraseña

# Paso 5.3.1: Modelo — campos de reset

Añade al schema User:

javascript
// server/src/models/User.js — añade al schema
passwordResetTokenHash: { type: String, select: false },
passwordResetExpiresAt: { type: Date, select: false },
# Paso 5.3.2: Servicio de email (server/src/config/email.js y server/src/services/email.service.js)

javascript
// server/src/config/email.js
import nodemailer from 'nodemailer';

export const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false,
  auth: process.env.EMAIL_USER
    ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    : undefined,
});

export async function verifyEmailConfig() {
  try {
    await transporter.verify();
    console.log('✅ SMTP configurado correctamente');
  } catch (err) {
    console.warn('⚠️  SMTP no disponible:', err.message);
  }
}
javascript
// server/src/services/email.service.js
import { transporter } from '../config/email.js';
import logger from '../config/logger.js';

const FROM = process.env.EMAIL_FROM || 'e_commerce_01 <no-reply@e_commerce_01.com>';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

async function send(to, subject, html) {
  try {
    const info = await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info({ messageId: info.messageId, to }, 'Email enviado');
    // Ethereal imprime una URL de preview
    const preview = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null;
    if (preview) logger.info({ preview }, 'Email preview URL');
    return info;
  } catch (err) {
    logger.error({ err, to }, 'Error enviando email');
    throw err;
  }
}

import nodemailer from 'nodemailer';

export async function sendWelcome(user) {
  const html = `
    <h1>Bienvenido, ${user.name}</h1>
    <p>Gracias por registrarte en e_commerce_01.</p>
    <p><a href="${FRONTEND}/products">Explorar catálogo</a></p>
  `;
  return send(user.email, 'Bienvenido a e_commerce_01', html);
}

export async function sendPasswordReset(user, resetUrl) {
  const html = `
    <h1>Recuperación de contraseña</h1>
    <p>Has solicitado resetear tu contraseña. El enlace expira en 1 hora.</p>
    <p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Resetear contraseña</a></p>
    <p>Si no fuiste tú, ignora este email.</p>
  `;
  return send(user.email, 'Recupera tu contraseña de e_commerce_01', html);
}

export async function sendOrderConfirmation(order) {
  const items = order.items
    .map((it) => `<li>${it.name} × ${it.quantity} — $${it.priceAtPurchase}</li>`)
    .join('');
  const html = `
    <h1>¡Gracias por tu compra!</h1>
    <p>Pedido <strong>#${order._id.toString().slice(-8).toUpperCase()}</strong></p>
    <ul>${items}</ul>
    <p><strong>Total: $${order.total}</strong></p>
    <p>Te enviaremos otro email cuando tu pedido sea despachado.</p>
    <p><a href="${FRONTEND}/orders/${order._id}">Ver detalle</a></p>
  `;
  return send(order.user.email, 'Tu pedido en e_commerce_01', html);
}
Setup para desarrollo con Ethereal:

Ve a ethereal.email y crea una cuenta.
Copia host, port, user, pass a tu .env.
Los emails no llegan a un buzón real, pero cada envío loguea una URL de preview.
# Paso 5.3.3: Endpoints de reset

Añade a auth.service.js:

javascript
import { generateResetToken, hashToken } from '../utils/jwt.js';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

export async function requestPasswordReset(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });

  // 🔐 Siempre devolvemos "ok" aunque el usuario no exista (anti-enumeración)
  if (!user) return { ok: true };

  const rawToken = generateResetToken();
  user.passwordResetTokenHash = hashToken(rawToken);
  user.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
  await user.save();

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`;
  // Envío asíncrono: no bloqueamos la respuesta (aunque si falla, el usuario ya está registrado)
  sendPasswordReset(user, resetUrl).catch((err) => {
    logger.error({ err }, 'Error enviando email de reset');
  });

  return { ok: true };
}

export async function resetPassword(rawToken, newPassword) {
  const hash = hashToken(rawToken);
  const user = await User.findOne({
    passwordResetTokenHash: hash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');

  if (!user) throw new AppError('Token inválido o expirado', 400);

  user.password = newPassword;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.refreshTokenHash = undefined; // invalida sesiones activas
  user.refreshTokenExpiresAt = undefined;
  await user.save();

  return user;
}
Añade al auth.controller.js:

javascript
export async function forgotPassword(req, res, next) {
  try {
    await authService.requestPasswordReset(req.body.email);
    res.status(202).json({
      status: 'success',
      message: 'Si el email existe, recibirás instrucciones.',
    });
  } catch (err) { next(err); }
}

export async function resetPassword(req, res, next) {
  try {
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ status: 'success', message: 'Contraseña actualizada. Inicia sesión.' });
  } catch (err) { next(err); }
}
Rutas:

javascript
router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().normalizeEmail()],
  validate,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  authLimiter,
  [
    body('token').isString().isLength({ min: 64, max: 64 }),
    body('password').isLength({ min: 8 })
      .matches(/[A-Z]/).matches(/[a-z]/).matches(/[0-9]/),
  ],
  validate,
  authController.resetPassword
);
# Paso 5.3.4: Frontend — páginas de reset

client/src/pages/ForgotPasswordPage.jsx:

jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import Button from '../components/Button.jsx';
import FormField from '../components/FormField.jsx';
import Alert from '../components/Alert.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 400, margin: '0 auto' }}>
        <h1>Revisa tu email</h1>
        <Alert variant="success">
          Si el email está registrado, recibirás un enlace para resetear tu contraseña.
        </Alert>
        <Link to="/login">Volver al login</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      <h1>Recuperar contraseña</h1>
      <form onSubmit={handleSubmit}>
        <FormField id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Button type="submit" fullWidth loading={submitting}>Enviar enlace</Button>
      </form>
    </div>
  );
}
client/src/pages/ResetPasswordPage.jsx:

jsx
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';
import Button from '../components/Button.jsx';
import FormField from '../components/FormField.jsx';
import Alert from '../components/Alert.jsx';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login', { state: { message: 'Contraseña actualizada. Inicia sesión.' } });
    } catch (err) {
      setError(err.response?.data?.message || 'Token inválido o expirado');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      <h1>Nueva contraseña</h1>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={handleSubmit}>
        <FormField id="password" label="Nueva contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required help="Mín. 8 caracteres con mayúscula, minúscula y número" />
        <FormField id="confirm" label="Confirmar contraseña" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <Button type="submit" fullWidth loading={submitting}>Cambiar contraseña</Button>
      </form>
    </div>
  );
}
Añade al App.jsx:

jsx
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.jsx'));

<Route path="/forgot-password" element={<ForgotPasswordPage />} />
<Route path="/reset-password/:token" element={<ResetPasswordPage />} />
Y en el LoginPage, añade el enlace:

jsx
<p style={{ marginTop: 16 }}>
  <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
</p>
✅ Checklist password reset:

□ Solicitar reset con email inexistente → 202 con "Si el email existe…" (mismo mensaje que con email real).
□ Solicitar reset con email real → llega email con link a /reset-password/:token.
□ En Ethereal, el email se ve bien.
□ Link válido → permite cambiar contraseña → login funciona con la nueva.
□ Reusar el mismo token → 400 "Token inválido o expirado".
□ Tras cambiar contraseña, sesiones activas previas quedan invalidadas.
📊 5.4 Observabilidad con pino

# Paso 5.4.1: Configurar logger (server/src/config/logger.js)

javascript
// server/src/config/logger.js
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'e_commerce_01-api', env: process.env.NODE_ENV },
  redact: {
    // 🔐 Nunca loguear campos sensibles
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      '*.password',
      '*.refreshTokenHash',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined, // JSON puro en prod (para agregadores)
});

export default logger;
Instala pino-pretty en dev:

bash
npm install --save-dev pino-pretty
# Paso 5.4.2: Middleware HTTP (server/src/middlewares/httpLogger.middleware.js)

javascript
// server/src/middlewares/httpLogger.middleware.js
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import logger from '../config/logger.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
# Paso 5.4.3: Añadir a app.js

javascript
import { httpLogger } from './middlewares/httpLogger.middleware.js';

app.use(httpLogger); // va primero, después de webhook (raw body)
# Paso 5.4.4: Reemplazar console.log en el código

Busca y reemplaza:

bash
cd server
grep -r "console\." src/ | grep -v node_modules
Reemplaza cada console.log/warn/error por logger.info/warn/error. Los más importantes:

server.js: logger.info({ port }, 'Servidor corriendo')
database.js: logger.info({ host }, 'MongoDB conectado')
error handler global de app.js: logger.error({ err, reqId: req.id }, 'Error')
# Paso 5.4.5: Health checks mejorados

Añade server/src/routes/health.routes.js:

javascript
import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

router.get('/ready', async (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = conectado
  if (dbState !== 1) {
    return res.status(503).json({ status: 'not_ready', db: 'disconnected' });
  }
  res.json({ status: 'ready', db: 'connected' });
});

export default router;
Monta en app.js (antes del error handler):

javascript
app.use('/', healthRoutes);
Concepto: /health = liveness (proceso vivo, sin tocar DB). /ready = readiness (puede servir tráfico, DB accesible). Kubernetes/Render usan estos endpoints para decidir cuándo enrutar tráfico.

✅ Checklist observabilidad:

□ Cada request loguea {reqId, method, url, statusCode, responseTime} en JSON.
□ req.headers.authorization aparece como [REDACTED].
□ Los errores incluyen el stack pero no el body con password.
□ /health responde sin tocar la DB.
□ /ready devuelve 503 si Mongo está caído.
🔁 5.5 CI/CD con GitHub Actions

# Paso 5.5.1: .github/workflows/ci.yml (test en cada push/PR)

yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test-server:
    name: Test backend
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7
        ports: ['27017:27017']
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand({ ping: 1 })'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: server/package-lock.json

      - name: Install deps
        working-directory: server
        run: npm ci

      - name: Init replica set (transactions)
        run: |
          docker exec $(docker ps -q --filter "ancestor=mongo:7") mongosh --eval "rs.initiate()"
        continue-on-error: true

      - name: Run tests
        working-directory: server
        env:
          NODE_ENV: test
          JWT_SECRET: test_secret_at_least_32_chars_long_for_ci_pipeline
          JWT_REFRESH_SECRET: another_secret_also_32_chars_for_ci_pipeline
          MONGODB_URI: mongodb://127.0.0.1:27017/e_commerce_01_test
          STRIPE_SECRET_KEY: sk_test_dummy
          STRIPE_WEBHOOK_SECRET: whsec_dummy
        run: npm test

  build-client:
    name: Build frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: client/package-lock.json
      - name: Install
        working-directory: client
        run: npm ci
      - name: Build
        working-directory: client
        run: npm run build
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: client-build
          path: client/dist
# Paso 5.5.2: .github/workflows/deploy.yml (deploy a producción en main)

yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-server:
    name: Deploy backend to Render
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render deploy
        run: |
          curl -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}"

  deploy-client:
    name: Deploy frontend to Vercel
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install Vercel CLI
        run: npm i -g vercel
      - name: Deploy
        working-directory: client
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: vercel deploy --prod --yes --token=$VERCEL_TOKEN
# Paso 5.5.3: Configurar secrets

En GitHub → Settings → Secrets and variables → Actions:

Secret	Cómo obtenerlo
RENDER_DEPLOY_HOOK	Render dashboard → Service → Settings → Deploy Hook
VERCEL_TOKEN	Vercel → Account Settings → Tokens
VERCEL_ORG_ID y VERCEL_PROJECT_ID	client/.vercel/project.json tras primer vercel link
# Paso 5.5.4: Proteger main

GitHub → Settings → Branches → Add branch protection rule:

✅ Require a pull request before merging
✅ Require status checks (test-server, build-client)
✅ Require conversation resolution
✅ Checklist CI/CD:

□ Push a cualquier rama → corre CI (tests + build).
□ PR a main → los checks aparecen en la PR.
□ Merge a main → Deploy dispara deploy a Render y Vercel.
□ Si los tests fallan, la PR no se puede mergear.
□ El deploy de Render reconstruye con docker build o npm start según config.
🏁 5.6 Checklist Global de la Fase 5

Stripe

□ Checkout redirige a Stripe Checkout real (test mode).
□ Pago con 4242 4242 4242 4242 → orden paid.
□ Webhook llega con firma válida (stripe listen).
□ Firma inválida → 400 (no 500).
□ Webhook duplicado → idempotente (no rompe).
□ Sesión expirada → stock restaurado automáticamente.
Refresh tokens

□ Login → cookie httpOnly con refreshToken (visible en DevTools, no en document.cookie).
□ Access token expira a los 15min → refresh automático invisible.
□ Logout → cookie eliminada + hash invalidado en DB.
□ Refresh robado + reuso → 401 + sesión completa invalidada.
Password reset

□ /forgot-password con email existente → email con link.
□ Link funciona una sola vez.
□ Token expirado (esperar 1h o manipular DB) → 400.
□ Cambio de contraseña invalida sesiones activas.
Emails

□ Bienvenida al registrarse.
□ Confirmación de pedido tras webhook checkout.session.completed.
□ Reset password con link válido.
□ En Ethereal se ven con formato correcto.
Observabilidad

□ Todos los logs en JSON (prod) o pretty (dev).
□ Authorization y cookie aparecen como [REDACTED].
□ x-request-id en cada respuesta.
□ /ready detecta Mongo caído → 503.
CI/CD

□ Push dispara CI.
□ Merge a main deploya.
□ main protegida requiere checks verdes.
Commit final

bash
git add .
git commit -m "feat: phase 5 — production readiness

- Stripe Checkout integration with signed webhooks (idempotent)
- Automatic refund on session expiry with stock restore
- Refresh token rotation with reuse detection (httpOnly cookies)
- Password recovery flow with single-use hashed tokens
- Transactional emails (welcome, order confirmation, reset)
- Structured logging with pino + request ID correlation
- Liveness/readiness health checks
- GitHub Actions CI (test + build) and CD (Render + Vercel)"
📊 5.7 Arquitectura Final del Proyecto

text
┌──────────────────────────────────────────────────────────────────┐
│                        e_commerce_01 v1.0                            │
│                     (production-ready)                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Cliente                    Backend                  Servicios   │
│  ┌─────────────┐      ┌──────────────────┐     ┌───────────────┐ │
│  │  React SPA  │      │  Express API     │     │   Stripe      │ │
│  │  Vite       │─HTTPS▶│                  │     │  (webhooks)   │ │
│  │  React Router│      │  ┌────────────┐  │     └───────┬───────┘ │
│  │  Context    │      │  │ auth       │  │             │         │
│  │  Lazy loads │      │  │ products   │  │◀── signed ──┘         │
│  │  Toasts     │      │  │ cart       │  │      POST              │
│  │  Skeletons  │      │  │ orders     │  │                        │
│  └─────────────┘      │  │ webhooks   │  │     ┌───────────────┐ │
│         │             │  │ uploads    │  │     │   Ethereal    │ │
│         │             │  │ health     │  │────▶│ / Nodemailer  │ │
│         ▼             │  └────────────┘  │     └───────────────┘ │
│  ┌─────────────┐      │                  │                       │
│  │ localstorage│      │  ┌────────────┐  │                       │
│  │ access token│      │  │ pino       │  │                       │
│  │ guest cart  │      │  │ logger     │  │                       │
│  └─────────────┘      │  └────────────┘  │                       │
│                       └────────┬─────────┘                       │
│                                │                                 │
│                       ┌────────▼─────────┐                       │
│                       │  MongoDB (rs0)   │                       │
│                       │  - users         │                       │
│                       │  - products      │                       │
│                       │  - carts         │                       │
│                       │  - orders        │                       │
│                       └──────────────────┘                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           CI/CD: GitHub Actions → Render + Vercel        │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
🎓 Lo que ya tienes

Al completar la Fase 5, tu proyecto e_commerce_01 es equivalente funcionalmente a un ecommerce real de mediana escala. Tienes:

Aspecto	Implementado
Catálogo, búsqueda, filtros, paginación	✅
Carrito invitado + auth con merge	✅
Checkout transaccional con reserva de stock	✅
Pago real con Stripe + webhooks firmados	✅
Auth con access + refresh tokens rotados	✅
Recuperación de contraseña	✅
Panel admin (productos + pedidos)	✅
Uploads de imagen	✅
Emails transaccionales	✅
Tests automatizados (incluyendo concurrencia)	✅
Logs estructurados + health checks	✅
Docker Compose	✅
CI/CD automatizado	✅
Esto es un portafolio sólido para demostrar dominio de full-stack JS.

🚀 Posibles Fase 6+ (si quieres seguir)

Ya sería "nice to have" más que "must have":

Reseñas de producto con moderación.
Wishlist (favoritos).
Cupones de descuento (con validación atómica de uso único).
Multi-moneda con conversión en tiempo real.
Búsqueda con Algolia/Meilisearch.
Panel de analytics (ventas, productos más vendidos).
2FA con TOTP para cuentas admin.
Migrar a TypeScript (buena inversión si el proyecto crece).
Rate limiting por usuario (no solo por IP).
Webhooks salientes (notificar a integraciones externas cuando cambia el estado de un pedido).
Cuando confirmes que la Fase 5 está operativa, especialmente Stripe con pagos reales en modo test, cierras el ciclo completo de un ecommerce profesional. 🎉