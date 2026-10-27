
___________________________________________________________
💳 FASE 5 — Producción Real: Stripe, Emails, Password Reset, Staging y CI/CD

📖 1. La Historia (El Porqué)

Hasta aquí se ha construido un flujo local. Esta fase cruza una frontera importante: el sistema empieza a coordinarse con un proveedor de pagos real en modo de prueba y prepara una ruta reproducible hacia staging y producción.

Puntos críticos a entender en esta fase:

La redirección de éxito NO confirma el pago: El navegador puede volver a una página de éxito porque el usuario manipuló la URL. La confirmación autoritativa llega solo mediante un Webhook de Stripe cuya firma se valida usando el cuerpo original (raw).
Transacción corta: La transacción de MongoDB para reservar stock debe cerrarse ANTES de llamar a Stripe. Si mantenemos la DB bloqueada esperando la red, colapsamos el sistema. Si Stripe falla, debemos tener una estrategia de compensación.
Webhooks Idempotentes: Stripe puede enviar el mismo evento varias veces. El handler debe reconocer eventos ya procesados y no duplicar acciones (ej. marcar como pagado dos veces).
Recuperación de contraseña Anti-enumeración: Siempre devolvemos {ok: true}, exista o no el email, para que los atacantes no puedan averiguar qué correos están registrados.
CI/CD y Staging: Staging debe parecerse a producción pero con variables separadas. El despliegue requiere migraciones previas y health checks.
___________________________________________________________
📋 2. El Checklist (El Qué)

□ Backend: Instalar stripe, nodemailer, pino, pino-http, pino-pretty.
□ Backend: Crear logger HTTP con x-request-id y /ready.
□ Backend: Crear stripe.service.ts y stripe.config.ts.
□ Backend: Actualizar modelo Order (Stripe ID, impuestos, envío).
□ Backend: Refactorizar checkout (Stripe fuera de transacción).
□ Backend: Crear webhook.routes.ts y webhook.service.ts.
□ Backend: Montar webhook ANTES de express.json().
□ Backend: Crear email.service.ts y email.config.ts (Ethereal).
□ Backend: Implementar Password Reset en auth.service.ts.
□ Frontend: Actualizar CheckoutPage para redirigir a Stripe.
□ Frontend: Crear OrderSuccessPage con polling.
□ Frontend: Crear ForgotPasswordPage y ResetPasswordPage.
□ Infra: Crear docker-compose.staging.yml y wait-ready.sh.
□ CI/CD: Configurar deploy.yml y k6 smoke test.

___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 5.1: Observabilidad y Health

server/src/middlewares/httpLogger.middleware.ts
___________________________________________________________
import pinoHttp from 'pino-http';
import { logger } from '../config/logger.js';
import crypto from 'node:crypto';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] as string || crypto.randomUUID(),
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
___________________________________________________________
server/src/routes/health.routes.ts
___________________________________________________________
import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => res.json({ status: 'ok' }));

healthRouter.get('/ready', async (_req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  if (!dbOk) return res.status(503).json({ status: 'not ready', db: false });
  res.json({ status: 'ready', db: true });
});
___________________________________________________________
Paso 5.2: Stripe y Checkout

server/src/config/stripe.ts
___________________________________________________________
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16', // Fijar versión de API
});
___________________________________________________________
Actualizar server/src/models/Order.ts
___________________________________________________________
// Añadir al schema:
  subtotal: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  shippingAmount: { type: Number, default: 0 },
  stripeSessionId: { type: String },
  stripePaymentIntentId: { type: String },
___________________________________________________________
Refactorizar server/src/services/order.service.ts
___________________________________________________________
import { stripe } from '../config/stripe.js';
import { CartModel } from '../models/Cart.js';
import { ProductModel } from '../models/Product.js';
import { OrderModel } from '../models/Order.js';
import { AppError } from '../utils/AppError.js';
import mongoose from 'mongoose';

export async function checkout(userId: string, dto: any, idempotencyKey: string) {
  const existing = await OrderModel.findOne({ idempotencyKey, userId });
  if (existing) return { order: existing, checkoutUrl: existing.stripeSessionUrl }; // Asumimos que guardamos la URL

  const session = await mongoose.startSession();
  let order: any;
  
  try {
    await session.withTransaction(async () => {
      const cart = await CartModel.findOne({ userId }).session(session).populate('items.product');
      if (!cart || cart.items.length === 0) throw new AppError(400, 'Carrito vacío', 'EMPTY_CART');

      let subtotal = 0;
      const items = [];

      for (const item of cart.items) {
        const product = item.product as any;
        const updated = await ProductModel.findOneAndUpdate(
          { _id: product._id, stock: { $gte: item.quantity }, isActive: true },
          { $inc: { stock: -item.quantity } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, `Stock insuficiente: ${product.name}`, 'OUT_OF_STOCK');

        subtotal += product.price * item.quantity;
        items.push({ product: product._id, name: product.name, priceAtPurchase: product.price, quantity: item.quantity });
      }

      const shippingAmount = 500; // Fase 8 lo hará dinámico
      const total = subtotal + shippingAmount;

      const [created] = await OrderModel.create([{
        userId, items, subtotal, shippingAmount, total, status: 'pending', paymentStatus: 'unpaid', shippingAddress: dto.shippingAddress, idempotencyKey
      }], { session });
      
      order = created;
      cart.items = [];
      await cart.save({ session });
    });
  } finally { 
    await session.endSession(); 
  }

  // FUERA de transacción: Crear sesión Stripe
  const stripeSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: order.items.map((i: any) => ({
      price_data: { currency: 'usd', product_data: { name: i.name }, unit_amount: i.priceAtPurchase },
      quantity: i.quantity,
    })),
    mode: 'payment',
    success_url: `${process.env.FRONTEND_URL}/orders/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/checkout`,
    metadata: { orderId: order.id },
  }, { idempotencyKey });

  order.stripeSessionId = stripeSession.id;
  order.stripeSessionUrl = stripeSession.url;
  await order.save();

  return { order, checkoutUrl: stripeSession.url };
}

export async function getOrderBySession(sessionId: string) {
  return OrderModel.findOne({ stripeSessionId: sessionId });
}
___________________________________________________________
Paso 5.3: Webhooks (CRÍTICO)

server/src/routes/webhook.routes.ts
___________________________________________________________
import { Router, raw } from 'express';
import { stripe } from '../config/stripe.js';
import { processEvent } from '../services/webhook.service.js';

export const webhookRouter = Router();

webhookRouter.post('/stripe',
  raw({ type: 'application/json' }), // CRÍTICO: raw body antes de express.json()
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    await processEvent(event);
    res.json({ received: true });
  }
);
___________________________________________________________
server/src/services/webhook.service.ts
___________________________________________________________
import { OrderModel } from '../models/Order.js';
import { ProductModel } from '../models/Product.js';
import { emailService } from './email.service.js';

export async function processEvent(event: any) {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // Idempotente: solo actualiza si aún no está paid
    const order = await OrderModel.findOneAndUpdate(
      { _id: session.metadata.orderId, paymentStatus: { $ne: 'paid' } },
      { $set: { paymentStatus: 'paid', status: 'confirmed', stripePaymentIntentId: session.payment_intent } },
      { new: true }
    );
    if (order) {
      await emailService.sendOrderConfirmation(order);
    }
  }
  
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const order = await OrderModel.findById(session.metadata.orderId);
    if (order && order.paymentStatus === 'unpaid') {
      // Restaurar stock (liberar reserva)
      for (const item of order.items) {
        await ProductModel.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
      }
      order.status = 'cancelled';
      await order.save();
    }
  }
}
___________________________________________________________
Actualizar server/src/app.ts
___________________________________________________________
import { webhookRouter } from './routes/webhook.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { httpLogger } from './middlewares/httpLogger.middleware.js';

app.use(httpLogger);

// 1. Webhooks (RAW) - ANTES de json
app.use('/api/webhooks', webhookRouter);

// 2. JSON Parser
app.use(express.json());

// 3. Rutas
app.use(healthRouter);
// ... resto de rutas ...
___________________________________________________________
Paso 5.4: Emails y Password Reset

server/src/services/email.service.ts
___________________________________________________________
import nodemailer from 'nodemailer';
import { logger } from '../config/logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

export const emailService = {
  async sendWelcome(user: any) {
    try {
      await transporter.sendMail({
        from: '"e_commerce_01" <noreply@e_commerce_01.com>',
        to: user.email,
        subject: 'Bienvenido a e_commerce_01',
        html: `<h1>Hola ${user.name}</h1><p>Gracias por registrarte.</p>`,
      });
    } catch (err) { logger.error({ err }, 'Error sending welcome email'); }
  },

  async sendPasswordReset(user: any, token: string) {
    const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await transporter.sendMail({
      from: '"e_commerce_01" <noreply@e_commerce_01.com>',
      to: user.email,
      subject: 'Recuperación de contraseña',
      html: `<p>Haz clic aquí para resetear tu contraseña: <a href="${url}">${url}</a></p>`,
    });
  },

  async sendOrderConfirmation(order: any) {
    // ...
  }
};
___________________________________________________________
Actualizar server/src/models/User.ts (Campos de reset)
___________________________________________________________
passwordResetTokenHash: { type: String, select: false },
passwordResetExpiresAt: { type: Date, select: false },
___________________________________________________________
Actualizar server/src/services/auth.service.ts
___________________________________________________________
import crypto from 'node:crypto';
import { emailService } from './email.service.js';

export async function requestPasswordReset(email: string) {
  const user = await UserModel.findOne({ email });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() + 3600000); // 1h
    await user.save();
    await emailService.sendPasswordReset(user, token);
  }
  // Anti-enumeración: siempre devolver ok
  return { ok: true };
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await UserModel.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');

  if (!user) throw new AppError(400, 'Token inválido o expirado', 'INVALID_TOKEN');

  user.password = newPassword;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.refreshTokenHash = undefined; // Invalida sesiones
  await user.save();
  return { ok: true };
}
___________________________________________________________
Paso 5.5: Frontend — Stripe, Success y Password Reset

Actualizar client/src/pages/CheckoutPage.tsx
___________________________________________________________
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setSubmitting(true);
  try {
    const res = await api.post('/orders/checkout', { shippingAddress: form }, {
      headers: { 'Idempotency-Key': idempotencyKey }
    });
    // Redirigir a Stripe (NO resetear submitting, la página se va)
    window.location.href = res.data.checkoutUrl;
  } catch (err: any) {
    setSubmitting(false);
    // ... manejo de errores ...
  }
};
___________________________________________________________
client/src/pages/OrderSuccessPage.tsx
___________________________________________________________
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../services/api';

export function OrderSuccessPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState('loading'); // loading, paid, pending, error
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (!sessionId) return setStatus('error');

    let attempts = 0;
    const poll = setInterval(async () => {
      try {
        const res = await api.get(`/orders/by-session/${sessionId}`);
        if (res.data.paymentStatus === 'paid') {
          setOrder(res.data);
          setStatus('paid');
          clearInterval(poll);
        }
      } catch (err) {
        console.error(err);
      }

      attempts++;
      if (attempts >= 20) { // 20 intentos x 1.5s = 30s
        setStatus('pending');
        clearInterval(poll);
      }
    }, 1500);

    return () => clearInterval(poll);
  }, [sessionId]);

  if (status === 'loading') return <div>Verificando pago...</div>;
  if (status === 'error') return <div>Error. No se encontró la sesión.</div>;
  if (status === 'pending') return <div>El pago está procesándose. Recibirás un correo pronto.</div>;

  return (
    <div style={{ textAlign: 'center', padding: '4rem' }}>
      <h1>¡Pago Exitoso! 🎉</h1>
      <p>Gracias por tu compra. Tu pedido # {order?.id.slice(-6)} ha sido confirmado.</p>
      <Link to="/orders">Ver mis pedidos</Link>
    </div>
  );
}
___________________________________________________________
Paso 5.6: Staging y CI/CD

scripts/wait-ready.sh
___________________________________________________________
#!/bin/bash
echo "Esperando a que el servidor esté listo..."
for i in {1..60}; do
  if curl -s http://localhost:3000/ready | grep -q "ready"; then
    echo "Servidor listo!"
    exit 0
  fi
  sleep 2
done
echo "Timeout esperando al servidor."
exit 1
___________________________________________________________
.github/workflows/deploy.yml (Fragmento de ejemplo)
___________________________________________________________
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Render
        run: curl -X POST ${{ secrets.RENDER_DEPLOY_HOOK }}
___________________________________________________________
🚦 4. Gate 5 (Validación)

No avances a la Fase 6 hasta que se cumplan TODOS estos puntos:

□ Pago de Prueba: Usar la tarjeta 4242 4242 4242 4242 en el checkout. La página debe redirigir a Stripe, completar el pago y volver a /orders/success.
□ Webhook Validado: En el dashboard de Stripe (o con Stripe CLI), verificar que el webhook se recibió con estado 200. Si se envía un webhook con firma inválida, el servidor debe devolver 400.
□ Idempotencia Webhook: Reenviar el mismo webhook desde Stripe. La orden no debe cambiar de estado ni duplicar correos.
□ Sesión Expirada: Dejar una orden pendiente sin pagar. Al expirar, el webhook checkout.session.expired debe restaurar el stock en MongoDB y cancelar la orden.
□ Recuperación de Contraseña:
Solicitar reset con email real → debe llegar el correo (revisar Ethereal).
Solicitar reset con email inexistente → debe devolver {ok: true} pero no enviar correo.
Usar el token una vez → funciona. Usarlo dos veces → falla.
Al resetear, las sesiones activas deben invalidarse (forzar re-login).
□ Health Checks: GET /health devuelve 200 (liveness). GET /ready devuelve 200 si Mongo está conectado y 503 si se cae la conexión.
□ Logs: Verificar que los logs tengan el x-request-id y que NO muestren la contraseña o tokens.