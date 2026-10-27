Fase 8 Granular: UX de Compra Pulida

Esta fase cierra la brecha entre "funciona" y "se siente profesional". Cada fricción eliminada aquí es una venta recuperada. Ya no es bloqueante legal ni de seguridad, así que puedes implementarla con la tienda vendiendo.

#	Componente	Impacto en conversión	Resultado
1	Imágenes optimizadas con sharp (WebP + 3 tamaños + srcset)	🔥 Alto	Catálogo carga 3-10x más rápido
2	Cálculo de envío	🔥 Alto	Cobras lo que cuesta enviar (o lo regalas estratégicamente)
3	Emails de cambio de estado	🟠 Medio	Menos tickets, más confianza
4	Accesibilidad AA	🟠 Medio	+15% usuarios potenciales
5	SEO (meta tags, sitemap, OG)	🔥 Alto	Tráfico orgánico desde Google
6	404 custom + estados vacíos	🟡 Bajo	Menos abandono
📦 8.0 Dependencias

Backend:

bash
cd server
npm install sharp
Frontend:

bash
cd client
npm install react-helmet-async
Añade a server/.env.example:

env
# ─── Envío ───────────────────────────────────────────────
SHIPPING_FREE_THRESHOLD=50
SHIPPING_DEFAULT_COST=9.99
SHIPPING_COUNTRIES=US,ES,MX,AR,CO,CL,PE
🖼️ 8.1 Optimización de Imágenes con sharp

El problema actual: subes una foto de 5MB y el catálogo tarda 3s. En móvil 4G, el cliente se va.

La solución: al subir la imagen, generar 3 tamaños en WebP + guardar el original como fallback. Servir con srcset para que el navegador descargue solo lo necesario.

# Paso 8.1.1: Refactorizar el middleware de upload

El upload.middleware.js actual guarda un solo archivo. Lo reemplazamos por un procesador que genera 3 tamaños.

Reemplaza server/src/middlewares/upload.middleware.js:

javascript
// server/src/middlewares/upload.middleware.js
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import logger from '../config/logger.js';

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 5);

// Tamaños de salida: [ancho, sufijo]
const SIZES = [
  { width: 200, suffix: 'thumb' },
  { width: 600, suffix: 'card' },
  { width: 1200, suffix: 'full' },
];

// Multer en memoria: procesamos con sharp antes de escribir a disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new AppError('Solo JPG, PNG o WebP', 400));
    }
    cb(null, true);
  },
}).single('image');

/**
 * Procesa la imagen en memoria y genera 3 tamaños WebP + 1 original.
 * Devuelve las URLs de cada tamaño.
 */
export async function processImage(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    throw new AppError('Extensión no soportada', 400);
  }

  const baseName = crypto.randomBytes(12).toString('hex');
  const yearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dir = path.join(UPLOAD_DIR, yearMonth);
  await fs.mkdir(dir, { recursive: true });

  const urls = {};
  const metadata = await sharp(buffer).metadata();

  for (const { width, suffix } of SIZES) {
    // No ampliar imágenes más pequeñas que el target
    const targetWidth = Math.min(width, metadata.width);
    const filename = `${baseName}-${suffix}.webp`;
    const filepath = path.join(dir, filename);

    await sharp(buffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(filepath);

    urls[suffix] = `/uploads/${yearMonth}/${filename}`;
  }

  // Guardar también el original (por si acaso en el futuro)
  const originalFilename = `${baseName}-original${ext}`;
  const originalPath = path.join(dir, originalFilename);
  await fs.writeFile(originalPath, buffer);
  urls.original = `/uploads/${yearMonth}/${originalFilename}`;

  logger.info({ urls, width: metadata.width, height: metadata.height }, 'Imagen procesada');

  return {
    urls,
    width: metadata.width,
    height: metadata.height,
    baseName,
  };
}

/**
 * Middleware listo para usar en la ruta.
 */
export function uploadProductImage(req, res, next) {
  upload(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return next(new AppError('No se subió archivo', 400));

    try {
      const result = await processImage(req.file.buffer, req.file.originalname);
      req.processedImage = result;
      next();
    } catch (procErr) {
      next(procErr);
    }
  });
}
# Paso 8.1.2: Actualizar el modelo Product

Los productos actuales tienen un solo imageUrl. Migramos a un objeto con múltiples variantes, manteniendo imageUrl como fallback para compatibilidad.

javascript
// server/src/models/Product.js — reemplaza el campo imageUrl
imageUrl: {
  type: String,
  trim: true,
  default: '', // mantener para retrocompatibilidad
},
images: {
  thumb: { type: String, default: '' },
  card:  { type: String, default: '' },
  full:  { type: String, default: '' },
  original: { type: String, default: '' },
},
Script de migración para poblar images.card desde imageUrl en productos existentes:

javascript
// server/src/scripts/migrate-images.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Product from '../models/Product.js';

async function main() {
  await connectDatabase();
  const products = await Product.find({
    imageUrl: { $ne: '' },
    'images.card': '',
  });

  let count = 0;
  for (const p of products) {
    p.images = {
      thumb: p.imageUrl,
      card: p.imageUrl,
      full: p.imageUrl,
      original: p.imageUrl,
    };
    await p.save();
    count++;
  }

  console.log(`✅ ${count} productos migrados`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
Ejecuta: node src/scripts/migrate-images.js

# Paso 8.1.3: Actualizar la ruta de upload

javascript
// server/src/routes/upload.routes.js
import { Router } from 'express';
import { uploadProductImage } from '../middlewares/upload.middleware.js';
import { protect, admin } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/product-image', protect, admin, uploadProductImage, (req, res) => {
  res.status(201).json({
    status: 'success',
    data: req.processedImage,
  });
});

export default router;
Respuesta esperada:

json
{
  "status": "success",
  "data": {
    "urls": {
      "thumb": "/uploads/2026-10/abc123-thumb.webp",
      "card": "/uploads/2026-10/abc123-card.webp",
      "full": "/uploads/2026-10/abc123-full.webp",
      "original": "/uploads/2026-10/abc123-original.jpg"
    },
    "width": 2400,
    "height": 1600,
    "baseName": "abc123"
  }
}
# Paso 8.1.4: Componente ProductImage con srcset

Crea client/src/components/ProductImage.jsx:

jsx
// client/src/components/ProductImage.jsx
/**
 * Imagen responsiva con srcset y lazy loading.
 * - sizes: hint al navegador sobre qué ancho necesita según viewport
 * - loading: lazy por defecto; usar "eager" en above-the-fold
 */
export default function ProductImage({
  images,
  fallbackUrl = '',
  alt,
  sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 33vw, 300px',
  loading = 'lazy',
  className,
  style,
}) {
  // Compatibilidad: si no hay `images`, usar el fallback
  const thumb = images?.thumb || fallbackUrl;
  const card = images?.card || fallbackUrl;
  const full = images?.full || fallbackUrl;

  if (!full) {
    // Placeholder cuando no hay imagen
    return (
      <div
        className={className}
        style={{
          background: 'var(--color-bg-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          aspectRatio: '1',
          ...style,
        }}
        aria-label="Sin imagen"
      >
        🖼️
      </div>
    );
  }

  const srcSet = [thumb && `${thumb} 200w`, card && `${card} 600w`, full && `${full} 1200w`]
    .filter(Boolean)
    .join(', ');

  return (
    <img
      src={card}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      style={style}
    />
  );
}
Uso en ProductListPage:

jsx
<ProductImage
  images={p.images}
  fallbackUrl={p.imageUrl}
  alt={p.name}
  sizes="(max-width: 640px) 100vw, 300px"
  style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 'var(--radius)' }}
/>
Uso en ProductDetailPage (above the fold → eager):

jsx
<ProductImage
  images={product.images}
  fallbackUrl={product.imageUrl}
  alt={product.name}
  loading="eager"
  sizes="(max-width: 768px) 100vw, 50vw"
  style={{ width: '100%', borderRadius: 'var(--radius)' }}
/>
# Paso 8.1.5: Actualizar ProductForm para subir la nueva estructura

En client/src/pages/admin/ProductForm.jsx, el handler de subida ahora guarda images:

jsx
async function handleFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);
  setUploading(true);
  try {
    const { data } = await api.post('/uploads/product-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    // Guardar las 3 variantes + fallback
    setForm((prev) => ({
      ...prev,
      images: data.data.urls,
      imageUrl: data.data.urls.card, // compatibilidad
    }));
    toast.success('Imagen optimizada y subida');
  } catch (err) {
    toast.error(err.response?.data?.message || 'Error subiendo imagen');
  } finally {
    setUploading(false);
    e.target.value = '';
  }
}
Y el preview:

jsx
{form.images?.card && (
  <img
    src={form.images.card}
    alt="Preview"
    style={{ marginTop: 8, maxWidth: 200, borderRadius: 'var(--radius)' }}
  />
)}
✅ Checklist 8.1:

□ Subir una foto de 3MB genera 3 archivos WebP de ~200px, ~600px, ~1200px.
□ El original se guarda también (para futuras re-generaciones).
□ En DevTools → Network, el catálogo carga la variante card (600px, ~50KB).
□ En móvil (375px viewport), carga card no full.
□ Lighthouse Performance > 90 en el catálogo.
🚚 8.2 Cálculo de Envío

El problema: hoy cobras solo el producto. No hay costo de envío, así que la tienda pierde dinero o no envía.

# Paso 8.2.1: Servicio de envío (server/src/services/shipping.service.js)

javascript
// server/src/services/shipping.service.js
import { AppError } from '../utils/AppError.js';

const FREE_THRESHOLD = Number(process.env.SHIPPING_FREE_THRESHOLD) || 50;
const DEFAULT_COST = Number(process.env.SHIPPING_DEFAULT_COST) || 9.99;

const COUNTRY_COSTS = {
  US: 9.99,
  ES: 7.5,
  MX: 8.5,
  AR: 12,
  CO: 11,
  CL: 10,
  PE: 13,
};

/**
 * Calcula el costo de envío dado el subtotal y el país.
 * @param {number} subtotal
 * @param {string} country - ISO 3166-1 alpha-2
 * @returns {{ cost: number, free: boolean, reason?: string }}
 */
export function calculateShipping(subtotal, country) {
  if (!country || !COUNTRY_COSTS[country]) {
    throw new AppError(`País no soportado para envío: ${country}`, 400);
  }

  // Envío gratis si supera el umbral
  if (subtotal >= FREE_THRESHOLD) {
    return { cost: 0, free: true, reason: `Envío gratis desde $${FREE_THRESHOLD}` };
  }

  return { cost: COUNTRY_COSTS[country], free: false };
}

/**
 * Info pública para el frontend (umbral y costos por país).
 */
export function getShippingInfo() {
  return {
    freeThreshold: FREE_THRESHOLD,
    costs: COUNTRY_COSTS,
  };
}
# Paso 8.2.2: Endpoint público de info de envío

javascript
// server/src/controllers/shipping.controller.js
import { getShippingInfo } from '../services/shipping.service.js';

export function info(req, res) {
  res.json({ status: 'success', data: getShippingInfo() });
}
javascript
// server/src/routes/shipping.routes.js
import { Router } from 'express';
import * as shippingController from '../controllers/shipping.controller.js';

const router = Router();
router.get('/info', shippingController.info);
export default router;
Montar en app.js:

javascript
import shippingRoutes from './routes/shipping.routes.js';
app.use('/api/shipping', shippingRoutes);
# Paso 8.2.3: Refactorizar el checkout para incluir envío

Reemplaza checkout en server/src/services/order.service.js. Ahora acepta country en shippingAddress (ya lo validamos en la Fase 2) y calcula envío antes de crear la orden.

javascript
// server/src/services/order.service.js
import { calculateShipping } from './shipping.service.js';

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

    // ─── Calcular subtotal (snapshot de precios) ──────────
    const orderItems = [];
    for (const item of cart.items) {
      const product = item.product;
      if (!product || !product.isActive) {
        throw new AppError('Producto no disponible', 409);
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

    const subtotal = orderItems.reduce(
      (sum, it) => sum + it.priceAtPurchase * it.quantity, 0
    );

    // ─── Calcular envío ──────────────────────────────────
    const shipping = calculateShipping(subtotal, shippingAddress.country);

    // Total antes de tax (Stripe Tax añade el impuesto)
    const total = subtotal + shipping.cost;

    const [order] = await Order.create(
      [{
        user: userId,
        items: orderItems,
        subtotal,
        shippingAmount: shipping.cost,
        taxAmount: 0, // se rellena en el webhook
        total,
        status: 'pending',
        shippingAddress,
      }],
      { session }
    );

    cart.items = [];
    await cart.save({ session });
    await session.commitTransaction();

    // ─── Crear Stripe Session ────────────────────────────
    const lineItems = [
      ...orderItems.map((it) => ({
        price_data: {
          currency: 'usd',
          product_data: { name: it.name, tax_code: process.env.STRIPE_TAX_CODE || 'txcd_99999999' },
          unit_amount: Math.round(it.priceAtPurchase * 100),
        },
        quantity: it.quantity,
      })),
      // Envío como line item separado (tax code distinto)
      ...(shipping.cost > 0 ? [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Envío a ${shippingAddress.country}`,
            tax_code: 'txcd_92010001', // Shipping
          },
          unit_amount: Math.round(shipping.cost * 100),
        },
        quantity: 1,
      }] : []),
    ];

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: process.env.STRIPE_SUCCESS_URL,
      cancel_url: process.env.STRIPE_CANCEL_URL,
      client_reference_id: order._id.toString(),
      metadata: { orderId: order._id.toString(), userId: userId.toString() },
      automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === 'true' },
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: (process.env.SHIPPING_COUNTRIES || 'US,ES,MX').split(','),
      },
      customer_creation: 'always',
      customer_update: { address: 'auto' },
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
# Paso 8.2.4: Frontend — mostrar el envío en el checkout

Actualiza CheckoutPage.jsx para calcular el envío en el cliente antes de pagar (feedback inmediato) y mostrarlo en el resumen:

jsx
// client/src/pages/CheckoutPage.jsx — añade dentro del componente
const [shippingInfo, setShippingInfo] = useState({ freeThreshold: 0, costs: {} });

useEffect(() => {
  api.get('/shipping/info')
    .then(({ data }) => setShippingInfo(data.data))
    .catch(() => {});
}, []);

// Cálculo reactivo del envío
const shippingCost = (() => {
  if (!form.country || !shippingInfo.costs[form.country]) return null;
  if (total >= shippingInfo.freeThreshold) return 0;
  return shippingInfo.costs[form.country];
})();
Y en el resumen del pedido (aside):

jsx
<aside className="card">
  <h3>Resumen</h3>
  {items.map((it) => (
    <div key={it.productId} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0' }}>
      <span>{it.name} × {it.quantity}</span>
      <strong>{formatCurrency(it.price * it.quantity)}</strong>
    </div>
  ))}

  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
    <span>Subtotal</span>
    <strong>{formatCurrency(total)}</strong>
  </div>

  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
    <span>Envío</span>
    <strong>
      {shippingCost === null
        ? '—'
        : shippingCost === 0
          ? <span style={{ color: 'var(--color-success)' }}>Gratis 🎉</span>
          : formatCurrency(shippingCost)}
    </strong>
  </div>

  {shippingInfo.freeThreshold > 0 && total < shippingInfo.freeThreshold && form.country && (
    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 'var(--space-2) 0' }}>
      Añade {formatCurrency(shippingInfo.freeThreshold - total)} más para envío gratis
    </p>
  )}

  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)', fontSize: 'var(--text-lg)' }}>
    <span>Total</span>
    <strong>
      {shippingCost !== null ? formatCurrency(total + shippingCost) : formatCurrency(total)}
    </strong>
  </div>
</aside>
⚠️ El total mostrado aquí no incluye impuestos (Stripe Tax los calcula en su dominio). Es un subtotal antes de impuestos, coherente con cómo Stripe los muestra en el Checkout.
# Paso 8.2.5: Mostrar envío en detalle de orden y email

OrderDetailPage:

jsx
<tr>
  <td colSpan={3} style={{ textAlign: 'right' }}>Subtotal</td>
  <td style={{ textAlign: 'right' }}>{formatCurrency(order.subtotal || order.total)}</td>
</tr>
{order.shippingAmount > 0 && (
  <tr>
    <td colSpan={3} style={{ textAlign: 'right' }}>Envío</td>
    <td style={{ textAlign: 'right' }}>{formatCurrency(order.shippingAmount)}</td>
  </tr>
)}
{order.taxAmount > 0 && (
  <tr>
    <td colSpan={3} style={{ textAlign: 'right' }}>Impuestos</td>
    <td style={{ textAlign: 'right' }}>{formatCurrency(order.taxAmount)}</td>
  </tr>
)}
<tr>
  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td>
  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(order.total)}</td>
</tr>
sendOrderConfirmation en email.service.js:

javascript
const items = order.items
  .map((it) => `<li>${it.name} × ${it.quantity} — $${(it.priceAtPurchase * it.quantity).toFixed(2)}</li>`)
  .join('');

const html = `
  <h1>¡Gracias por tu compra!</h1>
  <p>Pedido <strong>#${order._id.toString().slice(-8).toUpperCase()}</strong></p>
  <ul>${items}</ul>
  <table style="width:100%;margin-top:16px;border-top:1px solid #eee;padding-top:8px;">
    <tr><td>Subtotal</td><td style="text-align:right;">$${order.subtotal.toFixed(2)}</td></tr>
    ${order.shippingAmount > 0 ? `<tr><td>Envío</td><td style="text-align:right;">$${order.shippingAmount.toFixed(2)}</td></tr>` : ''}
    ${order.taxAmount > 0 ? `<tr><td>Impuestos</td><td style="text-align:right;">$${order.taxAmount.toFixed(2)}</td></tr>` : ''}
    <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>$${order.total.toFixed(2)}</strong></td></tr>
  </table>
`;
✅ Checklist 8.2:

□ Checkout muestra "Envío: Gratis" si subtotal ≥ umbral.
□ Checkout muestra "Añade $X más para envío gratis" cuando falta poco.
□ Cambiar país actualiza el costo de envío en tiempo real.
□ Stripe Checkout incluye el envío como line item.
□ La orden guarda subtotal, shippingAmount, taxAmount, total coherentes.
□ Email y detalle muestran el desglose completo.
📧 8.3 Emails de Cambio de Estado

El problema: el usuario paga y no sabe cuándo llega su paquete. Reduce confianza y genera tickets.

# Paso 8.3.1: Nuevas plantillas en email.service.js

Añade estas funciones al final de server/src/services/email.service.js:

javascript
// server/src/services/email.service.js

export async function sendOrderShipped(order, trackingUrl = null) {
  const html = `
    <h1>Tu pedido está en camino 🚚</h1>
    <p>Pedido <strong>#${order._id.toString().slice(-8).toUpperCase()}</strong></p>
    <p>Ya despachamos tu compra y está en manos del transportista.</p>
    ${trackingUrl ? `<p><a href="${trackingUrl}">Seguir mi envío</a></p>` : ''}
    <p>Dirección de entrega:</p>
    <p>${order.shippingAddress.street}<br>
    ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}</p>
  `;
  return enqueueEmail({ to: order.user.email, subject: 'Tu pedido está en camino', html });
}

export async function sendOrderDelivered(order) {
  const html = `
    <h1>Tu pedido fue entregado ✅</h1>
    <p>Pedido <strong>#${order._id.toString().slice(-8).toUpperCase()}</strong></p>
    <p>Esperamos que disfrutes tu compra. ¿Nos dejas una reseña?</p>
    <p><a href="${FRONTEND}/orders/${order._id}">Ver pedido</a></p>
  `;
  return enqueueEmail({ to: order.user.email, subject: 'Tu pedido fue entregado', html });
}

export async function sendOrderCancelled(order, reason = '') {
  const html = `
    <h1>Tu pedido fue cancelado</h1>
    <p>Pedido <strong>#${order._id.toString().slice(-8).toUpperCase()}</strong></p>
    ${reason ? `<p>Motivo: ${reason}</p>` : ''}
    <p>Si realizaste un pago, el reembolso se emitirá en 5-7 días hábiles.</p>
    <p><a href="${FRONTEND}/products">Seguir comprando</a></p>
  `;
  return enqueueEmail({ to: order.user.email, subject: 'Pedido cancelado', html });
}
# Paso 8.3.2: Enviar email al cambiar de estado

En server/src/services/order.service.js, reemplaza updateOrderStatus:

javascript
import {
  sendOrderShipped,
  sendOrderDelivered,
  sendOrderCancelled,
} from './email.service.js';
import logger from '../config/logger.js';

const ALLOWED_TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatus(orderId, newStatus, trackingUrl = null) {
  const order = await Order.findById(orderId).populate('user', 'email name');
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const allowed = ALLOWED_TRANSITIONS[order.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new AppError(`Transición inválida: ${order.status} → ${newStatus}`, 409);
  }

  const oldStatus = order.status;
  order.status = newStatus;
  await order.save();

  // ─── Enviar email según la transición (asíncrono, no bloquea) ──
  const emailMap = {
    shipped: () => sendOrderShipped(order, trackingUrl),
    delivered: () => sendOrderDelivered(order),
    cancelled: () => sendOrderCancelled(order, 'Solicitado por el administrador'),
  };

  if (emailMap[newStatus]) {
    emailMap[newStatus]().catch((err) => {
      logger.error({ err, orderId, transition: `${oldStatus}→${newStatus}` },
        'Error enviando email de cambio de estado');
    });
  }

  return order;
}
# Paso 8.3.3: Admin UI — campo de tracking al marcar como "shipped"

En client/src/pages/admin/AdminOrdersPage.jsx, modifica el changeStatus para pedir tracking cuando sea shipped:

jsx
async function changeStatus(order, newStatus) {
  let trackingUrl = null;

  if (newStatus === 'shipped') {
    trackingUrl = prompt('URL de tracking (opcional, deja vacío si no aplica):') || null;
  }

  if (!confirm(`Cambiar estado a "${newStatus}"?`)) return;

  try {
    await api.patch(`/orders/admin/${order._id}/status`, { status: newStatus, trackingUrl });
    toast.success('Estado actualizado');
    load();
  } catch (err) {
    toast.error(err.response?.data?.message || 'No se pudo actualizar');
  }
}
Y en la ruta backend PATCH /orders/admin/:id/status:

javascript
// server/src/routes/order.routes.js
router.patch(
  '/admin/:id/status',
  protect, admin,
  [
    body('status').isIn(['paid', 'shipped', 'delivered', 'cancelled']),
    body('trackingUrl').optional().isURL(),
  ],
  validate,
  orderController.adminUpdateStatus
);
Y el controlador:

javascript
// server/src/controllers/order.controller.js
export async function adminUpdateStatus(req, res, next) {
  try {
    const { status, trackingUrl } = req.body;
    const order = await orderService.updateOrderStatus(req.params.id, status, trackingUrl);
    res.json({ status: 'success', data: { order } });
  } catch (err) { next(err); }
}
✅ Checklist 8.3:

□ paid → shipped envía "Tu pedido está en camino" (con tracking si se proporcionó).
□ shipped → delivered envía "Tu pedido fue entregado".
□ paid → cancelled envía "Pedido cancelado".
□ Los emails no bloquean la respuesta del admin (cola de Fase 6).
♿ 8.4 Accesibilidad (a11y AA)

# Paso 8.4.1: Auditar

Instala axe DevTools en el navegador.
Ejecuta auditoría en /, /products, /product/:id, /cart, /checkout, /login.
Ejecuta Lighthouse Accessibility en móvil → objetivo ≥ 95.
# Paso 8.4.2: Correcciones típicas

Foco visible (muchos diseños lo eliminan sin querer). Añade a client/src/index.css:

css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Elimina outline solo cuando no es navegación por teclado */
button:focus:not(:focus-visible),
a:focus:not(:focus-visible) {
  outline: none;
}
Skip link para usuarios de teclado (en Layout.jsx):

jsx
<a
  href="#main-content"
  className="skip-link"
  style={{
    position: 'absolute',
    left: '-9999px',
    top: 'auto',
    width: 1,
    height: 1,
    overflow: 'hidden',
  }}
  onFocus={(e) => { e.target.style.left = '8px'; e.target.style.width = 'auto'; e.target.style.height = 'auto'; e.target.style.padding = '8px'; }}
  onBlur={(e) => { e.target.style.left = '-9999px'; }}
>
  Saltar al contenido
</a>
<main id="main-content">
  {/* ... */}
</main>
Contraste WCAG AA: los colores de --color-text-muted (#6b7280) sobre --color-bg (#ffffff) tienen ratio 4.83:1 (pasa AA para texto normal). Verifica con contrast-ratio.com.

Alt text significativo en imágenes:

jsx
<Link to={`/product/${p._id}`} aria-label={`Ver detalles de ${p.name}`}>
  <ProductImage alt={`Imagen de ${p.name}`} ... />
</Link>
Botones con aria-label cuando son solo icono:

jsx
<button aria-label="Eliminar del carrito" onClick={() => removeItem(it.productId)}>🗑️</button>
Formularios con aria-invalid y aria-describedby (ya lo hace FormField, verifica que el error se anuncie):

jsx
<input aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
{error && <span id={`${id}-error`} role="alert">{error}</span>}
Live regions para toasts (ya lo hace ToastContext con aria-live="polite").

# Paso 8.4.3: Auditoría con Lighthouse y axe

Test de teclado (obligatorio):

Abre el catálogo.
Pulsa Tab desde el inicio → debe recorrer: skip link → logo → nav → búsqueda → primer producto → "Añadir al carrito".
Enter en "Añadir al carrito" → añade producto + toast anunciado.
Ve al carrito → Tab por cada control → modifica cantidades → "Proceder al pago".
Completa un checkout entero solo con teclado.
✅ Checklist 8.4:

□ Lighthouse Accessibility ≥ 95 en todas las páginas.
□ axe DevTools sin errores críticos ni serios.
□ Se completa un checkout entero solo con teclado.
□ Skip link funciona.
□ Todos los <img> tienen alt (vacío si decorativa).
□ Botones de solo icono tienen aria-label.
□ Los toasts se anuncian (role="status" o aria-live).
🔍 8.5 SEO

# Paso 8.5.1: Configurar react-helmet-async

client/src/main.jsx:

jsx
import { HelmetProvider } from 'react-helmet-async';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <AppWithSentry />
    </HelmetProvider>
  </React.StrictMode>
);
# Paso 8.5.2: Componente Seo reutilizable

Crea client/src/components/Seo.jsx:

jsx
// client/src/components/Seo.jsx
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'e_commerce_01';
const DEFAULT_DESCRIPTION = 'La mejor selección de productos tecnológicos, directo a tu puerta.';

export default function Seo({
  title,
  description = DEFAULT_DESCRIPTION,
  image,
  type = 'website',
  url,
}) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  const siteUrl = import.meta.env.VITE_SITE_URL || 'https://e_commerce_01.com';
  const canonical = url ? `${siteUrl}${url}` : siteUrl;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph (Facebook, WhatsApp, LinkedIn) */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:site_name" content={SITE_NAME} />
      {image && <meta property="og:image" content={image} />}

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}
    </Helmet>
  );
}
# Paso 8.5.3: Aplicar Seo en cada página

HomePage:

jsx
<Seo title="Inicio" description="Descubre la mejor selección de productos tecnológicos en e_commerce_01." />
ProductListPage:

jsx
<Seo
  title="Catálogo"
  description="Explora nuestra selección de smartphones, laptops, audio y más."
  url="/products"
/>
ProductDetailPage:

jsx
<Seo
  title={product.name}
  description={product.description.slice(0, 160)}
  image={product.images?.full || product.imageUrl}
  type="product"
  url={`/product/${product._id}`}
/>
# Paso 8.5.4: sitemap.xml dinámico en el backend

Crea server/src/routes/sitemap.routes.js:

javascript
// server/src/routes/sitemap.routes.js
import { Router } from 'express';
import Product from '../models/Product.js';

const router = Router();
const SITE_URL = process.env.PUBLIC_URL || 'https://e_commerce_01.com';

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const products = await Product.find({ isActive: true }).select('_id updatedAt').lean();

    const staticPages = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/products', priority: '0.9', changefreq: 'daily' },
      { loc: '/legal/terms', priority: '0.3', changefreq: 'monthly' },
      { loc: '/legal/privacy', priority: '0.3', changefreq: 'monthly' },
    ];

    const urls = [
      ...staticPages.map((p) =>
        `<url><loc>${SITE_URL}${p.loc}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
      ),
      ...products.map((p) =>
        `<url><loc>${SITE_URL}/product/${p._id}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
      ),
    ];

    res.header('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`);
  } catch (err) { next(err); }
});

export default router;
Montar en app.js:

javascript
import sitemapRoutes from './routes/sitemap.routes.js';
app.use('/', sitemapRoutes);
client/public/robots.txt:

text
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /checkout
Disallow: /cart
Disallow: /orders

Sitemap: https://e_commerce_01.com/sitemap.xml
# Paso 8.5.5: Advertencia sobre SPA y SEO

Una SPA como esta funciona, pero Google la indexa con retraso (necesita ejecutar JS). Para SEO serio, considera:

Fase 9: Migrar a Next.js (SSR/SSG) o usar vite-plugin-ssg para prerenderizar rutas estáticas.
Solución intermedia: prerender con puppeteer en el build (como hace react-snap).
Para la mayoría de proyectos pequeños, con react-helmet-async + sitemap.xml + robots.txt, Google indexa en días/semanas.

✅ Checklist 8.5:

□ Cada página tiene <title> y <meta description> únicos.
□ sitemap.xml accesible en /sitemap.xml y lista todos los productos activos.
□ robots.txt correcto (admin/checkout/cart bloqueados).
□ Compartir un producto en WhatsApp muestra imagen + título + descripción.
□ Validar con Rich Results Test (opcional).
🚫 8.6 Página 404 Custom + Estados Vacíos

# Paso 8.6.1: Página 404

Crea client/src/pages/NotFoundPage.jsx:

jsx
// client/src/pages/NotFoundPage.jsx
import { Link } from 'react-router-dom';
import Button from '../components/Button.jsx';
import Seo from '../components/Seo.jsx';

export default function NotFoundPage() {
  return (
    <>
      <Seo title="Página no encontrada" />
      <div style={{ textAlign: 'center', padding: 'var(--space-12) 0' }}>
        <p style={{ fontSize: 96, fontWeight: 700, color: 'var(--color-text-subtle)', margin: 0 }}>404</p>
        <h1>Página no encontrada</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-6)' }}>
          La página que buscas no existe o fue movida.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
          <Link to="/products"><Button>Ver catálogo</Button></Link>
          <Link to="/"><Button variant="secondary">Ir al inicio</Button></Link>
        </div>
      </div>
    </>
  );
}
En App.jsx, reemplaza <Navigate to="/" replace /> por <NotFoundPage />:

jsx
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));
// ...
<Route path="*" element={<NotFoundPage />} />
# Paso 8.6.2: Empty states mejorados

Ya tienes EmptyState. Úsalo con mensajes claros en todas las listas:

Carrito vacío: "Tu carrito está vacío" + CTA "Ver catálogo".
Sin pedidos: "Aún no tienes pedidos" + CTA "Explorar productos".
Búsqueda sin resultados: "No encontramos productos para 'X'" + CTA "Limpiar filtros".
Admin sin productos: "Aún no hay productos" + CTA "Crear primer producto".
✅ Checklist 8.6:

□ /pagina-que-no-existe muestra el 404 custom (no redirige a /).
□ El 404 ofrece 2 CTAs claros.
□ Todos los empty states tienen título, descripción y CTA.
✅ 8.7 Checklist Global de la Fase 8

Imágenes

□ Upload genera 3 WebP + original.
□ Catálogo usa srcset (en DevTools se ve la variante cargada).
□ Lighthouse Performance ≥ 90 en catálogo.
□ LCP < 2.5s en móvil.
Envío

□ Checkout muestra "Envío gratis" si subtotal ≥ umbral.
□ Cambiar país recalcula en tiempo real.
□ Stripe Checkout incluye el envío como line item.
□ Detalle y email muestran el desglose.
Emails

□ 3 emails nuevos (shipped, delivered, cancelled) llegan tras transición.
□ El email de shipped incluye tracking si se proporcionó.
□ Los emails no bloquean la respuesta del admin.
a11y

□ Lighthouse Accessibility ≥ 95 en todas las páginas.
□ Checkout completo solo con teclado.
□ Skip link funcional.
□ axe DevTools sin errores críticos.
SEO

□ Cada página tiene <title> y <meta> únicos.
□ sitemap.xml accesible y lista productos.
□ robots.txt correcto.
□ Open Graph funciona (probar en WhatsApp).
404 y empty states

□ 404 custom con 2 CTAs.
□ 4 empty states bien diseñados.
Commit final

bash
git add .
git commit -m "feat(ux): phase 8 — image optimization, shipping, a11y, SEO

- Sharp-based image pipeline (3 WebP sizes + original) with responsive srcset
- Shipping calculator by country with free threshold and dynamic checkout display
- Order state emails (shipped, delivered, cancelled) with optional tracking
- WCAG AA compliance: focus-visible, skip link, aria labels, contrast
- SEO: react-helmet-async, per-page meta, dynamic sitemap.xml, robots.txt
- Custom 404 page and improved empty states"
📊 Resumen Visual de la Fase 8

text
┌──────────────────────────────────────────────────────────────┐
│                     UX DE COMPRA PULIDA                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  Sharp       │     │  Shipping    │     │  State      │  │
│  │  3 WebP      │     │  by country  │     │  emails     │  │
│  │  + srcset    │     │  + threshold │     │  + tracking │  │
│  └──────┬───────┘     └──────┬───────┘     └──────┬──────┘  │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │       Catálogo + Checkout + Post-venta               │   │
│  │       (LCP < 2.5s, sin fricción, comunicado)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  a11y AA     │     │  SEO         │     │  404 +      │  │
│  │  Lighthouse  │     │  Helmet      │     │  empty      │  │
│  │  ≥95         │     │  Sitemap     │     │  states     │  │
│  └──────────────┘     └──────────────┘     └─────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
