
___________________________________________________________
🖼️ FASE 8 — UX de Compra Pulida: Imágenes, Envío, a11y, SEO

📖 1. La Historia (El Porqué)

Ahora se optimizan imágenes, se implementa el envío, se mejoran accesibilidad y SEO, y se formalizan las migraciones. El objetivo es que la tienda sea más usable sin cambiar la autoridad del servidor sobre los datos comerciales.

Puntos críticos a entender en esta fase:

Imágenes Optimizadas: Subir una foto de 3MB hace que la web sea lentísima. Usamos sharp para convertirla a WebP en 3 tamaños (200px, 600px, 1200px) y usamos srcset en el HTML para que el navegador descargue solo lo necesario.
Envío e Impuestos: No se inventan. El backend calcula el costo de envío basado en reglas de negocio (ej. gratis si supera cierto monto). El mismo desglose debe aparecer en la UI, en la base de datos y en Stripe.
Migraciones: Los cambios de esquema no se aplican "a mano" en producción. Usamos migrate-mongo para versionar los cambios. Al igual que las imágenes antiguas, creamos un script idempotente para migrarlas al nuevo formato.
Accesibilidad (a11y): La tienda debe ser usable con el teclado. Añadimos focus-visible, un "Skip Link" para saltar al contenido, y asegurarnos de que los contrastes de color sean correctos.
SEO: Google debe entender la tienda. Usamos react-helmet-async para títulos únicos, generamos un sitemap.xml dinámico y un robots.txt que bloquee zonas privadas.
📋 2. El Checklist (El Qué)

□ Backend: Instalar sharp, migrate-mongo.
□ Frontend: Instalar react-helmet-async.
□ Backend (Migraciones): Configurar migrate-mongo-config.cjs y crear la primera migración.
□ Backend (Imágenes): Refactorizar upload.middleware.ts (memoryStorage + sharp). Crear image.service.ts. Crear script migrate-images.ts idempotente.
□ Backend (Envío): Crear shipping.service.ts. Refactorizar order.service.ts para desglose. Añadir línea de envío a Stripe.
□ Backend (Emails): Añadir emails para estados shipped, delivered, cancelled.
□ Frontend (Imágenes): Crear ProductImage.tsx con srcset. Actualizar ProductForm.tsx.
□ Frontend (Checkout): Calcular envío en tiempo real.
□ Frontend (SEO y A11y): Crear Seo.tsx, NotFoundPage.tsx, skip link en Layout.tsx, robots.txt.
□ Backend (Sitemap): Crear sitemap.routes.ts.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 8.1: Dependencias y Migraciones

Instalación:
___________________________________________________________
cd server
npm install sharp migrate-mongo
cd ../client
npm install react-helmet-async
___________________________________________________________
Configuración de Migraciones (server/migrate-mongo-config.cjs)
(Nota: Es .cjs porque migrate-mongo no soporta ESM puro aún)
___________________________________________________________
require('dotenv/config');

module.exports = {
  mongodb: { 
    url: process.env.MONGODB_URI, 
    databaseName: 'e_commerce_01' 
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.cjs',
};
___________________________________________________________
Crear la primera migración (server/migrations/20240101000000-add-images-and-terms.cjs)
___________________________________________________________
module.exports = {
  async up(db) {
    // 1. Añadir acceptedTermsAt a usuarios antiguos
    await db.collection('users').updateMany(
      { acceptedTermsAt: { $exists: false } },
      { $set: { acceptedTermsAt: new Date(), termsVersion: '0.9' } }
    );
    // 2. Añadir estructura de imágenes a productos
    await db.collection('products').updateMany(
      { images: { $exists: false } },
      [{ $set: { images: { card: '$imageUrl', thumb: '$imageUrl', full: '$imageUrl', original: '$imageUrl' } } }]
    );
  },
  async down(db) {
    await db.collection('products').updateMany({}, { $unset: { images: '' } });
  }
};
___________________________________________________________
(Ejecuta npx migrate-mongo up para aplicar los cambios).

Paso 8.2: Backend — Procesamiento de Imágenes

Actualizar server/src/models/Product.ts (Añadir estructura)
___________________________________________________________
// Añadir al schema:
images: {
  thumb: { type: String, default: '' },
  card: { type: String, default: '' },
  full: { type: String, default: '' },
  original: { type: String, default: '' },
},
___________________________________________________________
server/src/services/image.service.ts
___________________________________________________________
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function processImage(buffer: Buffer, baseName: string) {
  const dir = path.join(process.env.UPLOAD_DIR!, new Date().toISOString().slice(0, 7)); // Año-Mes
  await fs.mkdir(dir, { recursive: true });

  const sizes = { thumb: 200, card: 600, full: 1200 };
  const result: any = {};

  for (const [key, width] of Object.entries(sizes)) {
    const file = path.join(dir, `${baseName}-${key}.webp`);
    await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(file);
    result[key] = `/uploads/${path.basename(dir)}/${path.basename(file)}`;
  }

  const original = path.join(dir, `${baseName}-original.webp`);
  await sharp(buffer).webp({ quality: 90 }).toFile(original);
  result.original = `/uploads/${path.basename(dir)}/${path.basename(original)}`;

  return result;
}
___________________________________________________________
Refactorizar server/src/middlewares/upload.middleware.ts
___________________________________________________________
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';

const memStorage = multer.memoryStorage();

export const uploadProductImage = multer({
  storage: memStorage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 2) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Formato no permitido'));
    cb(null, true);
  },
}).single('image');

export async function validateAndProcessImage(req: any, res: any, next: any) {
  if (!req.file) return next();
  try {
    // Validar firma real con sharp (lanza error si no es imagen válida)
    const meta = await sharp(req.file.buffer).metadata();
    if (!meta.width || meta.width > 5000 || (meta.height ?? 0) > 5000) {
      throw new Error('Dimensiones inválidas');
    }
    const { processImage } = await import('../services/image.service.js');
    req.processedImage = await processImage(req.file.buffer, crypto.randomUUID());
    next();
  } catch (err) {
    next(err);
  }
}
___________________________________________________________
Actualizar server/src/routes/upload.routes.ts
___________________________________________________________
import { uploadProductImage, validateAndProcessImage } from '../middlewares/upload.middleware.js';

uploadRouter.post('/product-image', protect, admin, uploadProductImage, validateAndProcessImage, (req: any, res) => {
  res.json({ images: req.processedImage });
});
___________________________________________________________
Script Idempotente (server/src/scripts/migrate-images.ts)
___________________________________________________________
import mongoose from 'mongoose';
import { ProductModel } from '../models/Product.js';
import 'dotenv/config';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const products = await ProductModel.find({
    $or: [{ images: { $exists: false } }, { 'images.card': { $exists: false } }],
  });
  
  let updated = 0;
  for (const p of products) {
    p.images = { thumb: p.imageUrl, card: p.imageUrl, full: p.imageUrl, original: p.imageUrl };
    await p.save();
    updated++;
  }
  console.log(`Migrated ${updated} products`);
  await mongoose.disconnect();
}
run().catch(console.error);
___________________________________________________________
Paso 8.3: Backend — Envío y Emails de Estado

server/src/services/shipping.service.ts
___________________________________________________________
const FREE_THRESHOLD = Number(process.env.SHIPPING_FREE_THRESHOLD ?? 5000);
const DEFAULT_COST = Number(process.env.SHIPPING_DEFAULT_COST ?? 500);

export function calculateShipping(country: string, subtotal: number): number {
  if (subtotal >= FREE_THRESHOLD) return 0;
  return DEFAULT_COST;
}

export function getShippingInfo() {
  return {
    freeThreshold: FREE_THRESHOLD,
    defaultCost: DEFAULT_COST,
    countries: (process.env.SHIPPING_COUNTRIES ?? 'CO,MX,US,ES').split(','),
    currency: 'USD',
  };
}
___________________________________________________________
Actualizar server/src/services/order.service.ts (Checkout con envío)
___________________________________________________________
import { calculateShipping } from './shipping.service.js';

export async function checkout(userId: string, dto: any, idempotencyKey: string) {
  // ... (transacción de DB) ...
  // Dentro de la transacción, tras calcular el subtotal:
  const subtotal = total;
  const shippingAmount = calculateShipping(dto.shippingAddress.country, subtotal);
  const finalTotal = subtotal + shippingAmount;

  const [created] = await OrderModel.create([{
    userId, items, subtotal, shippingAmount, total: finalTotal, // <-- Guardar desglose
    status: 'pending', paymentStatus: 'unpaid', shippingAddress: dto.shippingAddress, idempotencyKey
  }], { session });
  // ...
  
  // En la llamada a Stripe:
  const stripeSession = await stripe.checkout.sessions.create({
    // ...
    line_items: [
      ...order.items.map((i: any) => ({
        price_data: { currency: 'usd', product_data: { name: i.name }, unit_amount: i.priceAtPurchase },
        quantity: i.quantity,
      })),
      // Añadir envío como línea separada si aplica
      ...(order.shippingAmount > 0 ? [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Envío' },
          unit_amount: order.shippingAmount,
        },
        quantity: 1,
      }] : []),
    ],
    // ...
  });
}
___________________________________________________________
Actualizar server/src/services/email.service.ts
___________________________________________________________
// Añadir métodos al objeto emailService:
async sendOrderShipped(order: any, trackingUrl?: string) {
  await enqueueEmail({
    to: order.userEmail ?? 'customer@example.com',
    subject: `Pedido ${order.id} enviado`,
    html: `<h1>Tu pedido está en camino</h1><p>Tracking: ${trackingUrl || 'N/A'}</p>`,
  });
},
async sendOrderDelivered(order: any) { /* ... */ },
async sendOrderCancelled(order: any) { /* ... */ },
___________________________________________________________
Actualizar server/src/services/order.service.ts (Integrar emails en transición)
___________________________________________________________
import { emailService } from './email.service.js';

export async function updateOrderStatus(orderId: string, newStatus: string, trackingUrl?: string) {
  // ... validar transición ...
  order.status = newStatus as any;
  await order.save();

  // Enviar email (no bloqueante vía cola)
  if (newStatus === 'shipped') emailService.sendOrderShipped(order, trackingUrl);
  if (newStatus === 'delivered') emailService.sendOrderDelivered(order);
  if (newStatus === 'cancelled') emailService.sendOrderCancelled(order);

  return order;
}
___________________________________________________________
Paso 8.4: Frontend — Imágenes Responsivas

client/src/components/ProductImage.tsx
___________________________________________________________
export function ProductImage({ images, alt, eager = false }: { images: any; alt: string; eager?: boolean }) {
  return (
    <img
      src={images.card}
      srcSet={`${images.thumb} 200w, ${images.card} 600w, ${images.full} 1200w`}
      sizes="(max-width: 600px) 200px, (max-width: 1200px) 600px, 1200px"
      loading={eager ? 'eager' : 'lazy'}
      alt={alt}
      style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
    />
  );
}
___________________________________________________________
Actualizar client/src/pages/admin/ProductForm.tsx (Usar nuevo endpoint)
___________________________________________________________
const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await api.post('/uploads/product-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    setImages(res.data.images); // { thumb, card, full, original }
  } catch (err) {
    alert('Error al subir imagen');
  }
};
___________________________________________________________
Paso 8.5: Frontend — SEO, 404 y Accesibilidad

client/src/components/Seo.tsx
___________________________________________________________
import { Helmet } from 'react-helmet-async';

export function Seo({ title, description, canonical, ogImage }: any) {
  return (
    <Helmet>
      <title>{title} | e_commerce_01</title>
      <meta name="description" content={description} />
      {canonical && <link rel="canonical" href={canonical} />}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {ogImage && <meta property="og:image" content={ogImage} />}
    </Helmet>
  );
}
___________________________________________________________
Actualizar client/src/main.tsx
___________________________________________________________

import { HelmetProvider } from 'react-helmet-async';
// ...
ReactDOM.createRoot(document.getElementById('root')!).render(
  <!-- <HelmetProvider>  Descomentar-->
    <App />
  <!-- </HelmetProvider> -->
);
___________________________________________________________
client/src/pages/NotFoundPage.tsx
___________________________________________________________
import { Link } from 'react-router-dom';
import { Seo } from '../components/Seo';

export function NotFoundPage() {
  return (
    <>
      <Seo title="404 - Página no encontrada" description="La página que buscas no existe" />
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <h1 style={{ fontSize: '6rem', margin: 0 }}>404</h1>
        <p style={{ fontSize: '1.5rem' }}>Esta página no existe</p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem' }}>
          <Link to="/" style={{ padding: '1rem', background: 'var(--color-primary)', color: 'white', textDecoration: 'none', borderRadius: '4px' }}>Volver al catálogo</Link>
          <Link to="/cart" style={{ padding: '1rem', border: '1px solid var(--color-primary)', borderRadius: '4px' }}>Ver carrito</Link>
        </div>
      </div>
    </>
  );
}
___________________________________________________________
Asegúrate de añadir <Route path="*" element={<NotFoundPage />} /> en App.tsx).

Actualizar client/src/index.css
___________________________________________________________
:focus-visible { 
  outline: 2px solid var(--color-primary); 
  outline-offset: 2px; 
}
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus { left: 1rem; top: 1rem; background: white; padding: 1rem; z-index: 999; }
___________________________________________________________
Actualizar client/src/components/Layout.tsx
___________________________________________________________
// Añadir al inicio del return:
<a href="#main-content" className="skip-link">Saltar al contenido</a>
// Añadir al main:
<main id="main-content" style={{ flex: 1, padding: '2rem' }}>
___________________________________________________________
Paso 8.6: Backend — Sitemap y Robots

server/src/routes/sitemap.routes.ts

___________________________________________________________
import { Router } from 'express';
import { ProductModel } from '../models/Product.js';

export const sitemapRouter = Router();
sitemapRouter.get('/sitemap.xml', async (_req, res) => {
  const products = await ProductModel.find({ isActive: true }).select('slug updatedAt');
  const base = process.env.FRONTEND_URL!;
  const urls = products.map((p) =>
    `<url><loc>${base}/products/${p.slug}</loc><lastmod>${p.updatedAt?.toISOString()}</lastmod></url>`
  ).join('');
  res.type('application/xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});
___________________________________________________________
(Montar en app.ts: app.use(sitemapRouter);)

client/public/robots.txt
___________________________________________________________
User-agent: *
Disallow: /admin
Disallow: /checkout
Disallow: /cart
Disallow: /orders
Sitemap: https://e_commerce_01.example.com/sitemap.xml
___________________________________________________________
🚦 4. Gate 8 (Validación)

No avances a la Fase 9 hasta que se cumplan TODOS estos puntos:

□ Imágenes Optimizadas: Subir una imagen de 3MB desde el panel de admin. En la carpeta uploads/YYYY-MM/, deben aparecer 4 archivos WebP (thumb, card, full, original).
□ srcset: En el catálogo, abrir DevTools (Network) y verificar que se carga la imagen -card.webp. Emular un móvil y verificar que carga -thumb.webp.
□ Envío Reactivo: En el checkout, cambiar el país. El costo de envío debe recalcularse. Si el subtotal supera el umbral, debe mostrar "Gratis".
□ Desglose en Orden: Al completar un pago, verificar en la orden (MongoDB) que shippingAmount tiene el valor correcto y total = subtotal + shippingAmount.
□ Emails de Estado: Como admin, cambiar el estado de un pedido a shipped. Debe llegar un correo (ver Ethereal) con el enlace de tracking (si se proporcionó).
□ A11y (Teclado): Navegar por el checkout usando solo Tab. El foco debe ser visible en todos los campos y botones. Al inicio de la página, presionar Tab una vez debe mostrar el Skip Link.
□ SEO:
Visitar cualquier página y verificar que el <title> es único.
Visitar /sitemap.xml y comprobar que lista los productos.
□ 404: Visitar una ruta inexistente (/asdf). Debe mostrar el diseño de 404 con los dos botones, no redirigir a /.
□ Migración: Ejecutar npx migrate-mongo status y verificar que la migración está aplicada. Ejecutar npx tsx src/scripts/migrate-images.ts dos veces seguidas y comprobar que la segunda vez indica 0 migrados (idempotencia).