Fase 2 Granular: Productos, Carrito y Checkout Transaccional

Esta fase construye el corazón del ecommerce: catálogo de productos, gestión de carrito (para invitados y usuarios logueados), y checkout con reserva atómica de stock. Es la fase más delicada del backend por las transacciones y la concurrencia.

Lo que construiremos:

Modelos Product, Cart (con CartItem embebidos) y Order (con OrderItem embebidos).
CRUD de productos (GET público, POST/PUT/DELETE solo admin).
Servicio de carrito con upsert (evita duplicados bajo concurrencia).
Checkout transaccional con decremento atómico de stock y rollback.
Script de seed para poblar productos de prueba.
Frontend: CartContext, useCart, ProductList, ProductDetail, CartPage.
Carrito para invitados (localStorage) con merge automático al hacer login.
⚠️ 2.0 Prerrequisito Crítico: MongoDB con Replica Set

Las transacciones de MongoDB (necesarias para el checkout atómico) requieren un replica set. Un MongoDB standalone (instalado con mongod por defecto o Docker simple) no las soporta.

Opciones:

Opción A — MongoDB Atlas (recomendado, 0 config)

Atlas M0 (gratis) ya es un replica set. Si estás usando Atlas desde la Fase 0, no tienes que hacer nada.

Opción B — Docker con replica set (local)

bash
docker rm -f e_commerce_01-mongo 2>/dev/null
docker run -d \
  --name e_commerce_01-mongo \
  -p 27017:27017 \
  -v e_commerce_01-mongo-data:/data/db \
  mongo:7 \
  --replSet rs0 --bind_ip_all

# Esperar ~5s y luego iniciar el replica set
sleep 5
docker exec e_commerce_01-mongo mongosh --eval "rs.initiate()"
Verifica con:

bash
docker exec e_commerce_01-mongo mongosh --eval "rs.status().ok"
# → 1 (éxito)
Opción C — MongoDB local nativo

Edita mongod.conf y añade:

yaml
replication:
  replSetName: rs0
Reinicia mongod y ejecuta mongosh --eval "rs.initiate()".

Verificación final (con cualquiera de las opciones):

bash
cd server
node -e "
import('./src/config/database.js').then(async ({ connectDatabase }) => {
  await connectDatabase();
  const mongoose = (await import('mongoose')).default;
  const s = await mongoose.startSession();
  try { s.startTransaction(); await s.abortTransaction(); console.log('✅ Transacciones soportadas'); }
  catch (e) { console.error('❌ Sin soporte de transacciones:', e.message); }
  finally { s.endSession(); await mongoose.disconnect(); }
});
"
Si ves ✅ Transacciones soportadas, puedes continuar. Si no, el checkout fallará en el commit.

🧰 2.1 Nuevas Dependencias y Utilidades

No necesitamos nuevas dependencias backend. mongoose ya soporta transacciones nativamente.

# Paso 2.1.1: Helper de paginación (server/src/utils/pagination.js)

javascript
// server/src/utils/pagination.js
import { AppError } from './AppError.js';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;

/**
 * Normaliza query params de paginación.
 * @returns {{ page: number, limit: number, skip: number }}
 */
export function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));

  if (isNaN(page) || isNaN(limit)) {
    throw new AppError('Parámetros de paginación inválidos', 400);
  }

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Construye el bloque de metadatos de paginación para la respuesta.
 */
export function buildPaginationMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}
📦 2.2 Modelo Product

# Paso 2.2.1: Crear server/src/models/Product.js

javascript
// server/src/models/Product.js
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      minlength: [3, 'Mínimo 3 caracteres'],
      maxlength: [120, 'Máximo 120 caracteres'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: [true, 'La descripción es obligatoria'],
      trim: true,
      maxlength: [2000, 'Máximo 2000 caracteres'],
    },
    price: {
      type: Number,
      required: [true, 'El precio es obligatorio'],
      min: [0, 'El precio no puede ser negativo'],
    },
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'MXN'],
    },
    stock: {
      type: Number,
      required: [true, 'El stock es obligatorio'],
      min: [0, 'El stock no puede ser negativo'],
      validate: {
        validator: Number.isInteger,
        message: 'El stock debe ser un entero',
      },
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      default: 'general',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true, // Para filtrar productos activos rápido
    },
  },
  { timestamps: true }
);

// Índice de texto para búsqueda futura
productSchema.index({ name: 'text', description: 'text' });

// Índice compuesto para listados por categoría
productSchema.index({ category: 1, isActive: 1, createdAt: -1 });

// ─── toJSON: limpiar campos internos ──────────────────────
productSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

// ─── Static: generar slug único ───────────────────────────
productSchema.statics.generateSlug = async function (name) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  let slug = base;
  let counter = 1;

  // Colisión check: si ya existe, añade sufijo -2, -3, ...
  while (await this.exists({ slug })) {
    slug = `${base}-${counter++}`;
  }

  return slug;
};

const Product = mongoose.model('Product', productSchema);
export default Product;
Decisiones clave:

Detalle	Justificación
slug con unique	URLs amigables (/product/iphone-15-pro) y estables. generateSlug maneja colisiones.
stock con min: 0 y Number.isInteger	Evita stock negativo y fraccionario (no vendemos medios productos).
isActive soft delete	En ecommerce nunca se hace DELETE físico de productos: las órdenes históricas referencian el producto. isActive: false lo oculta sin romper pedidos.
Índice compuesto { category, isActive, createdAt }	Optimiza el query típico del catálogo: "productos activos de categoría X, ordenados por novedad".
Índice text	Prepara búsqueda full-text (GET /api/products?q=iphone).
🛒 2.3 Modelo Cart

# Paso 2.3.1: Crear server/src/models/Cart.js

javascript
// server/src/models/Cart.js
import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Mínimo 1 unidad'],
      max: [99, 'Máximo 99 unidades por producto'],
      validate: { validator: Number.isInteger, message: 'Debe ser entero' },
    },
  },
  { _id: false } // no necesitamos _id por cada item del carrito
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // 1 carrito por usuario
      index: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// ─── Virtual: total calculado (requiere populate) ─────────
cartSchema.virtual('total').get(function () {
  return this.items.reduce((sum, item) => {
    const price = item.product?.price ?? 0;
    return sum + price * item.quantity;
  }, 0);
});

cartSchema.set('toJSON', { virtuals: true });
cartSchema.set('toObject', { virtuals: true });

const Cart = mongoose.model('Cart', cartSchema);
export default Cart;
Decisiones:

Detalle	Justificación
user con unique: true	Un carrito por usuario. Uso masivo de upsert en el servicio.
items._id: false	Los items no son entidades independientes; su clave es product. Reduce ruido.
quantity con max: 99	Límite antiabuso y contra posibles bugs de UI.
virtual('total')	El total se calcula en lectura; nunca se persiste en el carrito (precios cambian).
📋 2.4 Modelo Order

# Paso 2.4.1: Crear server/src/models/Order.js

javascript
// server/src/models/Order.js
import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: { type: String, required: true }, // snapshot
    priceAtPurchase: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'La orden debe tener al menos un item',
      },
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    shippingAddress: {
      type: addressSchema,
      required: true,
    },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 }); // historial por usuario

orderSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Order = mongoose.model('Order', orderSchema);
export default Order;
Decisiones críticas:

Detalle	Justificación
priceAtPurchase y name snapshot	Aunque el producto cambie de nombre o precio en el futuro, la orden histórica no se altera. Este es el requisito no escrito más importante de un ecommerce.
address embebido	Si el usuario cambia su dirección, la orden ya enviada sigue con la dirección original. Inmutabilidad histórica.
status con enum	Estados claros: pending → paid → shipped → delivered. cancelled como estado terminal.
Índice { user, createdAt }	"Mis pedidos" ordenados por fecha desc — la vista más consultada.
📦 2.5 Servicio de Productos

# Paso 2.5.1: Crear server/src/services/product.service.js

javascript
// server/src/services/product.service.js
import Product from '../models/Product.js';
import { AppError } from '../utils/AppError.js';
import { parsePagination, buildPaginationMeta } from '../utils/pagination.js';

/**
 * Lista productos activos con filtros y paginación.
 */
export async function listProducts(query) {
  const { page, limit, skip } = parsePagination(query);

  const filter = { isActive: true };
  if (query.category) filter.category = query.category;
  if (query.q) {
    // Búsqueda simple (preparada para text index en producción)
    filter.$or = [
      { name: { $regex: query.q, $options: 'i' } },
      { description: { $regex: query.q, $options: 'i' } },
    ];
  }

  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);

  return { products, meta: buildPaginationMeta({ page, limit, total }) };
}

export async function getProductById(id) {
  const product = await Product.findById(id);
  if (!product || !product.isActive) {
    throw new AppError('Producto no encontrado', 404);
  }
  return product;
}

export async function createProduct(data) {
  const slug = await Product.generateSlug(data.name);
  const product = await Product.create({ ...data, slug });
  return product;
}

export async function updateProduct(id, data) {
  // Si cambian el nombre, regeneramos slug
  if (data.name) {
    data.slug = await Product.generateSlug(data.name);
  }

  const product = await Product.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
  if (!product) throw new AppError('Producto no encontrado', 404);
  return product;
}

export async function deleteProduct(id) {
  // Soft delete: preserva integridad referencial
  const product = await Product.findByIdAndUpdate(
    id,
    { isActive: false },
    { new: true }
  );
  if (!product) throw new AppError('Producto no encontrado', 404);
  return product;
}
🛍️ 2.6 Servicio de Carrito

# Paso 2.6.1: Crear server/src/services/cart.service.js

javascript
// server/src/services/cart.service.js
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import { AppError } from '../utils/AppError.js';

/**
 * Obtiene (o crea) el carrito del usuario con productos populados.
 */
export async function getCart(userId) {
  let cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return cart;
}

/**
 * Añade un item al carrito. Si ya existe, incrementa la cantidad.
 * Usa actualización atómica para evitar race conditions.
 */
export async function addItem(userId, productId, quantity = 1) {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError('Producto no encontrado o no disponible', 404);
  }

  if (product.stock < quantity) {
    throw new AppError(
      `Stock insuficiente. Disponible: ${product.stock}`,
      409
    );
  }

  // Atomic: findOneAndUpdate con $inc sobre item existente
  // Si no existe, $push con el nuevo item
  const cart = await Cart.findOneAndUpdate(
    { user: userId, 'items.product': productId },
    { $inc: { 'items.$.quantity': quantity } },
    { new: true }
  ).populate('items.product');

  if (cart) return cart; // ya existía, incrementamos

  // No existía: lo creamos
  const updated = await Cart.findOneAndUpdate(
    { user: userId },
    { $push: { items: { product: productId, quantity } } },
    { new: true, upsert: true }
  ).populate('items.product');

  return updated;
}

/**
 * Actualiza la cantidad absoluta de un item (no incrementa).
 */
export async function updateItemQuantity(userId, productId, quantity) {
  if (quantity < 1 || quantity > 99) {
    throw new AppError('Cantidad inválida (1–99)', 400);
  }

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError('Producto no encontrado', 404);
  }
  if (product.stock < quantity) {
    throw new AppError(`Stock insuficiente. Disponible: ${product.stock}`, 409);
  }

  const cart = await Cart.findOneAndUpdate(
    { user: userId, 'items.product': productId },
    { $set: { 'items.$.quantity': quantity } },
    { new: true }
  ).populate('items.product');

  if (!cart) throw new AppError('El producto no está en el carrito', 404);

  return cart;
}

export async function removeItem(userId, productId) {
  const cart = await Cart.findOneAndUpdate(
    { user: userId },
    { $pull: { items: { product: productId } } },
    { new: true }
  ).populate('items.product');

  if (!cart) throw new AppError('Carrito no encontrado', 404);
  return cart;
}

export async function clearCart(userId, session = null) {
  const opts = session ? { session } : {};
  await Cart.findOneAndUpdate({ user: userId }, { $set: { items: [] } }, opts);
}
Decisión clave — el patrón $inc/$push atómico:

El flujo clásico con read-then-write tiene race condition:

js
const cart = await Cart.findOne({user});        // read
const item = cart.items.find(...);              // check
if (item) item.quantity += n; else cart.items.push(...);  // mutate
await cart.save();                              // write
Si dos peticiones llegan simultáneas, ambas leen quantity: 1, ambas escriben quantity: 2. Pérdida de incrementos.

El patrón con findOneAndUpdate + $inc delega la atomicidad a MongoDB (operación atómica a nivel documento). Esto elimina la race condition sin locks.

💳 2.7 Servicio de Checkout (el núcleo)

# Paso 2.7.1: Crear server/src/services/order.service.js

javascript
// server/src/services/order.service.js
import mongoose from 'mongoose';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { AppError } from '../utils/AppError.js';

/**
 * Ejecuta el checkout de forma transaccional.
 *
 * Flujo:
 *   1. Abrir sesión + transacción
 *   2. Leer carrito
 *   3. Para cada item: decremento ATÓMICO de stock (con validación $gte)
 *   4. Crear Order con snapshot de precios
 *   5. Vaciar carrito
 *   6. Commit (o abort si algo falla)
 *
 * Si cualquier Paso falla, TODO se revierte (incluido el stock).
 */
export async function checkout(userId, shippingAddress) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─── 1. Obtener carrito con productos populados ─────
    const cart = await Cart.findOne({ user: userId })
      .populate('items.product')
      .session(session);

    if (!cart || cart.items.length === 0) {
      throw new AppError('El carrito está vacío', 400);
    }

    // ─── 2. Decrementar stock atómicamente ──────────────
    // Para cada item: findOneAndUpdate con $gte garantiza atomicidad
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.product;

      if (!product || !product.isActive) {
        throw new AppError(`Producto no disponible: ${item.product}`, 409);
      }

      // 🔒 Atómico: solo decrementa si hay stock suficiente
      const updated = await Product.findOneAndUpdate(
        { _id: product._id, stock: { $gte: item.quantity }, isActive: true },
        { $inc: { stock: -item.quantity } },
        { new: true, session }
      );

      if (!updated) {
        // Alguien más compró el stock entre nuestro read y este update
        throw new AppError(
          `Stock insuficiente para "${product.name}". Intenta de nuevo.`,
          409
        );
      }

      // Snapshot: precios y nombres fijos en la orden
      orderItems.push({
        product: product._id,
        name: product.name,
        priceAtPurchase: product.price,
        quantity: item.quantity,
      });
    }

    // ─── 3. Calcular total (en servidor, nunca confiar en cliente) ──
    const total = orderItems.reduce(
      (sum, it) => sum + it.priceAtPurchase * it.quantity,
      0
    );

    // ─── 4. Crear la orden ──────────────────────────────
    // En producción real, aquí se llamaría a Stripe/PayPal y el status
    // quedaría 'pending' hasta que el webhook confirme el pago.
    // Para esta fase, mockeamos el pago exitoso.
    const [order] = await Order.create(
      [
        {
          user: userId,
          items: orderItems,
          total,
          status: 'paid', // ⚠️ mock: en real sería 'pending' → webhook → 'paid'
          shippingAddress,
        },
      ],
      { session }
    );

    // ─── 5. Vaciar carrito ──────────────────────────────
    cart.items = [];
    await cart.save({ session });

    // ─── 6. Commit ──────────────────────────────────────
    await session.commitTransaction();

    return order;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Historial de pedidos del usuario.
 */
export async function listUserOrders(userId) {
  return Order.find({ user: userId }).sort({ createdAt: -1 });
}

/**
 * Obtiene un pedido propio (el usuario solo puede ver el suyo).
 */
export async function getUserOrder(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  return order;
}
Por qué este código es correcto bajo concurrencia:

Punto crítico	Solución implementada
Stock check + decremento	findOneAndUpdate con filtro { stock: { $gte: qty } } es atómico a nivel documento. Si dos checkouts compiten por la última unidad, solo uno pasa el filtro; el otro recibe null → rollback.
Consistencia entre decremento y orden	Todo en una transacción. Si falla la creación de la orden, el stock se restaura.
Total calculado	En servidor, con snapshot de precios. Nunca se confía en un total enviado por el cliente.
Idempotencia	El carrito se vacía en la misma transacción; un retry tras error encontraría carrito vacío → 400. Evita doble-compra por reintentos.
🎛️ 2.8 Controladores

# Paso 2.8.1: server/src/controllers/product.controller.js

javascript
// server/src/controllers/product.controller.js
import * as productService from '../services/product.service.js';

export async function list(req, res, next) {
  try {
    const { products, meta } = await productService.listProducts(req.query);
    res.json({ status: 'success', data: { products, meta } });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const product = await productService.getProductById(req.params.id);
    res.json({ status: 'success', data: { product } });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const product = await productService.createProduct(req.body);
    res.status(201).json({ status: 'success', data: { product } });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const product = await productService.updateProduct(req.params.id, req.body);
    res.json({ status: 'success', data: { product } });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await productService.deleteProduct(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
}
# Paso 2.8.2: server/src/controllers/cart.controller.js

javascript
// server/src/controllers/cart.controller.js
import * as cartService from '../services/cart.service.js';

export async function get(req, res, next) {
  try {
    const cart = await cartService.getCart(req.user._id);
    res.json({ status: 'success', data: { cart } });
  } catch (err) { next(err); }
}

export async function addItem(req, res, next) {
  try {
    const { productId, quantity = 1 } = req.body;
    const cart = await cartService.addItem(req.user._id, productId, quantity);
    res.status(200).json({ status: 'success', data: { cart } });
  } catch (err) { next(err); }
}

export async function updateItem(req, res, next) {
  try {
    const { quantity } = req.body;
    const cart = await cartService.updateItemQuantity(
      req.user._id,
      req.params.productId,
      quantity
    );
    res.json({ status: 'success', data: { cart } });
  } catch (err) { next(err); }
}

export async function removeItem(req, res, next) {
  try {
    const cart = await cartService.removeItem(req.user._id, req.params.productId);
    res.json({ status: 'success', data: { cart } });
  } catch (err) { next(err); }
}

export async function clear(req, res, next) {
  try {
    await cartService.clearCart(req.user._id);
    res.status(204).send();
  } catch (err) { next(err); }
}
# Paso 2.8.3: server/src/controllers/order.controller.js

javascript
// server/src/controllers/order.controller.js
import * as orderService from '../services/order.service.js';

export async function checkout(req, res, next) {
  try {
    const order = await orderService.checkout(req.user._id, req.body.shippingAddress);
    res.status(201).json({ status: 'success', data: { order } });
  } catch (err) { next(err); }
}

export async function list(req, res, next) {
  try {
    const orders = await orderService.listUserOrders(req.user._id);
    res.json({ status: 'success', data: { orders } });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const order = await orderService.getUserOrder(req.user._id, req.params.id);
    res.json({ status: 'success', data: { order } });
  } catch (err) { next(err); }
}
🛣️ 2.9 Rutas

# Paso 2.9.1: server/src/routes/product.routes.js

javascript
// server/src/routes/product.routes.js
import { Router } from 'express';
import { body, param } from 'express-validator';
import * as productController from '../controllers/product.controller.js';
import { validate } from '../middlewares/validate.js';
import { protect, admin } from '../middlewares/auth.middleware.js';

const router = Router();

const productBodyValidators = [
  body('name').trim().isLength({ min: 3, max: 120 }),
  body('description').trim().isLength({ min: 10, max: 2000 }),
  body('price').isFloat({ min: 0 }).toFloat(),
  body('stock').isInt({ min: 0 }).toInt(),
  body('imageUrl').optional().isURL().withMessage('imageUrl debe ser URL'),
  body('category').optional().trim().isLength({ max: 50 }),
  body('currency').optional().isIn(['USD', 'EUR', 'MXN']),
];

const idParam = param('id').isMongoId().withMessage('ID inválido');

// Públicas
router.get('/', productController.list);
router.get('/:id', idParam, validate, productController.getById);

// Admin
router.post('/', protect, admin, productBodyValidators, validate, productController.create);
router.put('/:id', protect, admin, idParam, productBodyValidators, validate, productController.update);
router.delete('/:id', protect, admin, idParam, validate, productController.remove);

export default router;
# Paso 2.9.2: server/src/routes/cart.routes.js

javascript
// server/src/routes/cart.routes.js
import { Router } from 'express';
import { body, param } from 'express-validator';
import * as cartController from '../controllers/cart.controller.js';
import { validate } from '../middlewares/validate.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(protect); // todo el carrito requiere auth

router.get('/', cartController.get);

router.post(
  '/items',
  [
    body('productId').isMongoId().withMessage('productId inválido'),
    body('quantity').optional().isInt({ min: 1, max: 99 }).toInt(),
  ],
  validate,
  cartController.addItem
);

router.patch(
  '/items/:productId',
  [
    param('productId').isMongoId(),
    body('quantity').isInt({ min: 1, max: 99 }).toInt(),
  ],
  validate,
  cartController.updateItem
);

router.delete(
  '/items/:productId',
  param('productId').isMongoId(),
  validate,
  cartController.removeItem
);

router.delete('/', cartController.clear);

export default router;
# Paso 2.9.3: server/src/routes/order.routes.js

javascript
// server/src/routes/order.routes.js
import { Router } from 'express';
import { body } from 'express-validator';
import * as orderController from '../controllers/order.controller.js';
import { validate } from '../middlewares/validate.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(protect);

const addressValidators = [
  body('shippingAddress.street').trim().notEmpty().withMessage('Calle requerida'),
  body('shippingAddress.city').trim().notEmpty().withMessage('Ciudad requerida'),
  body('shippingAddress.state').trim().notEmpty().withMessage('Estado requerido'),
  body('shippingAddress.postalCode').trim().notEmpty().withMessage('Código postal requerido'),
  body('shippingAddress.country').trim().notEmpty().withMessage('País requerido'),
  body('shippingAddress.phone').trim().notEmpty().withMessage('Teléfono requerido'),
];

router.post('/checkout', addressValidators, validate, orderController.checkout);
router.get('/', orderController.list);
router.get('/:id', orderController.getById);

export default router;
# Paso 2.9.4: Actualizar server/src/app.js

Añade los imports y app.use:

javascript
import productRoutes from './routes/product.routes.js';
import cartRoutes from './routes/cart.routes.js';
import orderRoutes from './routes/order.routes.js';

// ...
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
🌱 2.10 Script de Seed de Productos

# Paso 2.10.1: Crear server/src/scripts/seedProducts.js

javascript
// server/src/scripts/seedProducts.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import Product from '../models/Product.js';

const sampleProducts = [
  {
    name: 'iPhone 15 Pro',
    description: 'Titanio, chip A17 Pro, cámara 48MP. 256GB.',
    price: 1099,
    stock: 25,
    category: 'smartphones',
    imageUrl: 'https://picsum.photos/seed/iphone/400/400',
  },
  {
    name: 'MacBook Air M3',
    description: '13", chip M3, 16GB RAM, 512GB SSD.',
    price: 1499,
    stock: 15,
    category: 'laptops',
    imageUrl: 'https://picsum.photos/seed/macbook/400/400',
  },
  {
    name: 'AirPods Pro 2',
    description: 'Cancelación activa de ruido, USB-C.',
    price: 249,
    stock: 60,
    category: 'audio',
    imageUrl: 'https://picsum.photos/seed/airpods/400/400',
  },
  {
    name: 'iPad Air',
    description: '11", chip M2, 128GB, Wi-Fi.',
    price: 599,
    stock: 30,
    category: 'tablets',
    imageUrl: 'https://picsum.photos/seed/ipad/400/400',
  },
  {
    name: 'Apple Watch Ultra 2',
    description: 'Titanio, GPS + Cellular, 49mm.',
    price: 799,
    stock: 20,
    category: 'wearables',
    imageUrl: 'https://picsum.photos/seed/watch/400/400',
  },
  {
    name: 'Magic Keyboard',
    description: 'Teclado inalámbrico con Touch ID, teclado numérico.',
    price: 149,
    stock: 5, // stock bajo para probar el 409
    category: 'accessories',
    imageUrl: 'https://picsum.photos/seed/keyboard/400/400',
  },
];

async function main() {
  await connectDatabase();

  await Product.deleteMany({});
  console.log('🧹 Colección de productos limpiada');

  for (const p of sampleProducts) {
    const slug = await Product.generateSlug(p.name);
    await Product.create({ ...p, slug });
  }

  console.log(`✅ ${sampleProducts.length} productos insertados`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
Ejecuta:

bash
cd server
node src/scripts/seedProducts.js
Añade un script al package.json:

json
"scripts": {
  "dev": "node --watch src/server.js",
  "start": "node src/server.js",
  "seed": "node src/scripts/seedProducts.js",
  "test": "node --test"
}
Ahora puedes usar npm run seed.

✅ 2.11 Testing Manual con curl

Reinicia el backend (Ctrl+C y npm run dev). Asegúrate de tener un usuario admin (si no, actualiza el rol en MongoDB, ver Fase 1 paso 1.11 prueba 11).

Preparación: obtener tokens

bash
# Token de ADMIN
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"Password123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Registrar cliente
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Luis Cliente","email":"luis@example.com","password":"Password123"}' > /dev/null

# Token de CLIENTE
USER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"luis@example.com","password":"Password123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Admin: ${ADMIN_TOKEN:0:20}..."
echo "User:  ${USER_TOKEN:0:20}..."
Prueba 1: Listar productos (público)

bash
curl -s http://localhost:3000/api/products?page=1\&limit=3 | jq .
Esperado (200): array con 3 productos y meta: { page:1, limit:3, total:6, totalPages:2, hasNext:true, hasPrev:false }.

Prueba 2: Crear producto sin auth → 401

bash
curl -s -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","description":"test description here","price":10,"stock":5}' | jq .
Esperado: { "status":"error", "message":"Token no proporcionado" }.

Prueba 3: Crear producto con rol user → 403

bash
curl -s -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","description":"test description here","price":10,"stock":5}' | jq .
Esperado: { "status":"error", "message":"Acceso denegado: se requiere rol admin" }.

Prueba 4: Crear producto con admin → 201

bash
curl -s -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Samsung Galaxy S24",
    "description":"Flagship de Samsung con IA integrada, 256GB.",
    "price":999,
    "stock":40,
    "category":"smartphones",
    "imageUrl":"https://picsum.photos/seed/s24/400/400"
  }' | jq .
Esperado (201): producto con slug: "samsung-galaxy-s24".

Prueba 5: Carrito — añadir item

Guarda el _id de un producto en una variable (usaremos iPhone 15 Pro):

bash
PRODUCT_ID=$(curl -s http://localhost:3000/api/products?q=iPhone | jq -r '.data.products[0]._id')
echo "Product: $PRODUCT_ID"

curl -s -X POST http://localhost:3000/api/cart/items \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}" | jq .
Esperado (200): carrito con 1 item, quantity: 2, total virtual calculado.

Prueba 6: Carrito — añadir el MISMO item (debe incrementar)

bash
curl -s -X POST http://localhost:3000/api/cart/items \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}" | jq '.data.cart.items'
Esperado: 1 solo item con quantity: 3 (no dos items duplicados).

Prueba 7: Carrito — stock insuficiente → 409

bash
curl -s -X POST http://localhost:3000/api/cart/items \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":9999}" | jq .
Esperado: { "status":"error", "message":"Stock insuficiente. Disponible: 25" }.

Prueba 8: Carrito — actualizar cantidad

bash
curl -s -X PATCH http://localhost:3000/api/cart/items/$PRODUCT_ID \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quantity":1}' | jq '.data.cart.items'
Esperado: quantity: 1.

Prueba 9: Checkout — orden exitosa

bash
curl -s -X POST http://localhost:3000/api/orders/checkout \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "shippingAddress": {
      "street":"Calle Falsa 123",
      "city":"Springfield",
      "state":"IL",
      "postalCode":"62704",
      "country":"US",
      "phone":"+1 555 123 4567"
    }
  }' | jq .
Esperado (201): orden con status: "paid", total: 1099, items con snapshot (name, priceAtPurchase, quantity).

Verifica el decremento de stock:

bash
curl -s http://localhost:3000/api/products/$PRODUCT_ID | jq '.data.product.stock'
# Antes: 25 → Ahora: 24
Verifica que el carrito se vació:

bash
curl -s http://localhost:3000/api/cart \
  -H "Authorization: Bearer $USER_TOKEN" | jq '.data.cart.items'
# → []
Prueba 10: Checkout con carrito vacío → 400

bash
curl -s -X POST http://localhost:3000/api/orders/checkout \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"shippingAddress":{"street":"x","city":"y","state":"z","postalCode":"1","country":"US","phone":"1"}}' | jq .
Esperado: { "status":"error", "message":"El carrito está vacío" }.

Prueba 11: Historial de pedidos

bash
curl -s http://localhost:3000/api/orders \
  -H "Authorization: Bearer $USER_TOKEN" | jq '.data.orders | length'
# → 1
Prueba 12: Prueba de fuego — concurrencia

Este es el test más importante de la fase. Insertamos un producto con stock 1 y lanzamos 10 checkouts concurrentes desde 10 usuarios distintos. Solo 1 debe pasar; los 9 restantes reciben 409.

bash
# Crear producto con stock 1
LOW_STOCK_ID=$(curl -s -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Reliquia Única",
    "description":"Producto con stock de 1 unidad para prueba de concurrencia.",
    "price":1,
    "stock":1
  }' | jq -r '.data.product._id')

echo "Producto de prueba: $LOW_STOCK_ID"

# Registrar 10 usuarios y añadir el producto a cada carrito
TOKENS=()
for i in {1..10}; do
  EMAIL="race$i@example.com"
  curl -s -X POST http://localhost:3000/api/auth/register \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Racer $i\",\"email\":\"$EMAIL\",\"password\":\"Password123\"}" > /dev/null

  T=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Password123\"}" \
    | grep -o '"token":"[^"]*' | cut -d'"' -f4)
  TOKENS+=("$T")

  curl -s -X POST http://localhost:3000/api/cart/items \
    -H "Authorization: Bearer $T" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$LOW_STOCK_ID\",\"quantity\":1}" > /dev/null
done

# Lanzar 10 checkouts en paralelo
for i in {0..9}; do
  (
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST http://localhost:3000/api/orders/checkout \
      -H "Authorization: Bearer ${TOKENS[$i]}" \
      -H "Content-Type: application/json" \
      -d '{"shippingAddress":{"street":"x","city":"y","state":"z","postalCode":"1","country":"US","phone":"1"}}')
    echo "User $((i+1)): HTTP $STATUS"
  ) &
done
wait
Resultado esperado: exactamente un HTTP 201 y nueve HTTP 409. Este es el comportamiento correcto del decremento atómico + transacción.

Verifica el stock final:

bash
curl -s http://localhost:3000/api/products/$LOW_STOCK_ID | jq '.data.product.stock'
# → 0
Verifica que solo se creó 1 orden:

bash
mongosh "mongodb://127.0.0.1:27017/e_commerce_01" --eval '
  db.orders.countDocuments({ "items.product": ObjectId("'$LOW_STOCK_ID'") })
'
# → 1
✅ Checklist de validación backend:

□ GET /api/products público, paginado, con filtros.
□ POST/PUT/DELETE /api/products requiere admin (401/403 correctos).
□ POST /api/cart/items con mismo producto incrementa, no duplica.
□ Stock insuficiente → 409 con mensaje claro.
□ PATCH/DELETE de items funciona.
□ Checkout exitoso: orden creada, stock decrementado, carrito vacío.
□ Checkout con carrito vacío → 400.
□ Checkout con producto inactivo → 409 (soft-deleted).
□ Test de concurrencia: 1 éxito, 9 conflictos, 1 orden en DB, stock en 0.
□ Historial devuelve solo los pedidos del usuario.
Commit del backend:

bash
git add server/
git commit -m "feat(server): products, cart and transactional checkout

- Product model with slug and soft delete
- Cart model with embedded items and atomic \$inc/\$push operations
- Order model with immutable price snapshot
- Transactional checkout with atomic stock decrement and rollback
- Product CRUD (admin only)
- Cart and order endpoints (protected)
- Seed script for sample products"
⚛️ 2.12 Frontend: Catálogo y Carrito

# Paso 2.12.1: Helper de moneda (client/src/utils/formatCurrency.js)

javascript
// client/src/utils/formatCurrency.js
export function formatCurrency(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}
# Paso 2.12.2: Crear client/src/context/CartContext.jsx

Unifica carrito de invitado (localStorage) y carrito autenticado (servidor), con merge al hacer login.

jsx
// client/src/context/CartContext.jsx
import { createContext, useState, useEffect, useContext, useCallback } from 'react';
import api from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';

const CartContext = createContext(null);
const LS_KEY = 'guest_cart';

/**
 * Estructura del carrito local (invitado):
 * [{ productId, quantity, name, price, imageUrl }]
 * Denormalizamos nombre/precio/imagen para renderizar sin consultar el backend.
 */
function readGuestCart() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || [];
  } catch {
    return [];
  }
}

function writeGuestCart(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

export function CartProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState([]);   // shape: [{ product, quantity }] con product populado o plano
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Cargar carrito según estado de auth ──────────────
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Invitado: lee de localStorage
      setItems(readGuestCart());
      setLoading(false);
      return;
    }

    // Autenticado: merge + cargar del servidor
    async function loadAuthCart() {
      setLoading(true);
      try {
        // Merge guest cart → server
        const guestCart = readGuestCart();
        if (guestCart.length > 0) {
          for (const item of guestCart) {
            try {
              await api.post('/cart/items', {
                productId: item.productId,
                quantity: item.quantity,
              });
            } catch {
              // Stock insuficiente u otro error: ignoramos ese item
            }
          }
          localStorage.removeItem(LS_KEY);
        }

        const { data } = await api.get('/cart');
        setItems(data.data.cart.items || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Error cargando carrito');
      } finally {
        setLoading(false);
      }
    }

    loadAuthCart();
  }, [user, authLoading]);

  // ─── addItem ──────────────────────────────────────────
  const addItem = useCallback(
    async (product, quantity = 1) => {
      setError(null);

      if (user) {
        try {
          const { data } = await api.post('/cart/items', {
            productId: product._id || product.productId,
            quantity,
          });
          setItems(data.data.cart.items);
        } catch (err) {
          setError(err.response?.data?.message || 'Error añadiendo al carrito');
          throw err;
        }
        return;
      }

      // Invitado: localStorage
      const current = readGuestCart();
      const existing = current.find((it) => it.productId === product._id);

      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + quantity);
      } else {
        current.push({
          productId: product._id,
          quantity,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          stock: product.stock,
        });
      }
      writeGuestCart(current);
      setItems(current);
    },
    [user]
  );

  // ─── updateQuantity ───────────────────────────────────
  const updateQuantity = useCallback(
    async (productId, quantity) => {
      setError(null);
      if (quantity < 1) return;

      if (user) {
        try {
          const { data } = await api.patch(`/cart/items/${productId}`, { quantity });
          setItems(data.data.cart.items);
        } catch (err) {
          setError(err.response?.data?.message || 'Error actualizando');
          throw err;
        }
        return;
      }

      const current = readGuestCart();
      const item = current.find((it) => it.productId === productId);
      if (item) {
        item.quantity = quantity;
        writeGuestCart(current);
        setItems([...current]);
      }
    },
    [user]
  );

  // ─── removeItem ───────────────────────────────────────
  const removeItem = useCallback(
    async (productId) => {
      setError(null);

      if (user) {
        try {
          const { data } = await api.delete(`/cart/items/${productId}`);
          setItems(data.data.cart.items);
        } catch (err) {
          setError(err.response?.data?.message || 'Error eliminando');
          throw err;
        }
        return;
      }

      const current = readGuestCart().filter((it) => it.productId !== productId);
      writeGuestCart(current);
      setItems(current);
    },
    [user]
  );

  // ─── clearCart ────────────────────────────────────────
  const clearCart = useCallback(async () => {
    if (user) {
      try {
        await api.delete('/cart');
        setItems([]);
      } catch (err) {
        setError(err.response?.data?.message || 'Error vaciando carrito');
      }
      return;
    }
    localStorage.removeItem(LS_KEY);
    setItems([]);
  }, [user]);

  // ─── Derived data ─────────────────────────────────────
  const normalizedItems = items.map((it) => ({
    productId: it.product?._id || it.productId,
    quantity: it.quantity,
    name: it.product?.name || it.name,
    price: it.product?.price ?? it.price ?? 0,
    imageUrl: it.product?.imageUrl ?? it.imageUrl,
  }));

  const total = normalizedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const count = normalizedItems.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items: normalizedItems, total, count, loading, error, addItem, updateQuantity, removeItem, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

export default CartContext;
# Paso 2.12.3: Hook useCart (client/src/hooks/useCart.js)

javascript
// client/src/hooks/useCart.js
import { useContext } from 'react';
import CartContext from '../context/CartContext.jsx';

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart debe usarse dentro de <CartProvider>');
  return ctx;
}
# Paso 2.12.4: Página ProductListPage (client/src/pages/ProductListPage.jsx)

jsx
// client/src/pages/ProductListPage.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useCart } from '../hooks/useCart.js';
import { formatCurrency } from '../utils/formatCurrency.js';

export default function ProductListPage() {
  const [products, setProducts] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { addItem } = useCart();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/products?page=${page}&limit=12`)
      .then(({ data }) => {
        if (cancelled) return;
        setProducts(data.data.products);
        setMeta(data.data.meta);
      })
      .catch((err) => setError(err.response?.data?.message || 'Error cargando productos'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [page]);

  async function handleAdd(product) {
    try {
      await addItem(product, 1);
    } catch {
      // error del CartContext
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Cargando productos…</p>;
  if (error) return <p style={{ padding: 24, color: 'crimson' }}>{error}</p>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Catálogo</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        {products.map((p) => (
          <article key={p._id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
            <Link to={`/product/${p._id}`}>
              <img src={p.imageUrl} alt={p.name} style={{ width: '100%', borderRadius: 6 }} />
            </Link>
            <h3 style={{ fontSize: 16, margin: '8px 0' }}>{p.name}</h3>
            <p style={{ margin: 0, color: '#666' }}>{formatCurrency(p.price)}</p>
            <p style={{ margin: '4px 0', fontSize: 12, color: p.stock > 0 ? 'green' : 'crimson' }}>
              {p.stock > 0 ? `Stock: ${p.stock}` : 'Agotado'}
            </p>
            <button
              onClick={() => handleAdd(p)}
              disabled={p.stock === 0}
              style={{ width: '100%', padding: 8, marginTop: 8 }}
            >
              Añadir al carrito
            </button>
          </article>
        ))}
      </div>

      {meta && meta.totalPages > 1 && (
        <div style={{ marginTop: 24, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span>Página {meta.page} de {meta.totalPages}</span>
          <button disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        </div>
      )}
    </main>
  );
}
# Paso 2.12.5: Página ProductDetailPage (client/src/pages/ProductDetailPage.jsx)

jsx
// client/src/pages/ProductDetailPage.jsx
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useCart } from '../hooks/useCart.js';
import { formatCurrency } from '../utils/formatCurrency.js';

export default function ProductDetailPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { addItem } = useCart();

  useEffect(() => {
    api
      .get(`/products/${id}`)
      .then(({ data }) => setProduct(data.data.product))
      .catch((err) => setError(err.response?.data?.message || 'Error'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleAdd() {
    try {
      await addItem(product, qty);
    } catch {
      /* error ya en CartContext */
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Cargando…</p>;
  if (error || !product) return <p style={{ padding: 24, color: 'crimson' }}>{error || 'No encontrado'}</p>;

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Link to="/">← Volver al catálogo</Link>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
        <img src={product.imageUrl} alt={product.name} style={{ width: '100%', borderRadius: 8 }} />
        <div>
          <h1>{product.name}</h1>
          <p style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCurrency(product.price)}</p>
          <p>{product.description}</p>
          <p>Stock: {product.stock}</p>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <input
              type="number"
              min="1"
              max={product.stock}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(product.stock, +e.target.value)))}
              style={{ width: 80, padding: 8 }}
            />
            <button onClick={handleAdd} disabled={product.stock === 0} style={{ padding: 8 }}>
              Añadir {qty} al carrito
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
# Paso 2.12.6: Página CartPage (client/src/pages/CartPage.jsx)

jsx
// client/src/pages/CartPage.jsx
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../hooks/useCart.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatCurrency } from '../utils/formatCurrency.js';

export default function CartPage() {
  const { items, total, loading, updateQuantity, removeItem, error } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  if (loading) return <p style={{ padding: 24 }}>Cargando carrito…</p>;

  if (items.length === 0) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Carrito</h1>
        <p>Tu carrito está vacío. <Link to="/">Ver catálogo</Link></p>
      </main>
    );
  }

  function goToCheckout() {
    if (!user) {
      // Guardar la intención y mandar a login
      navigate('/login', { state: { from: { pathname: '/checkout' } } });
    } else {
      navigate('/checkout');
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1>Carrito ({items.length})</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {items.map((it) => (
        <div
          key={it.productId}
          style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #eee', padding: 12 }}
        >
          <img src={it.imageUrl} alt={it.name} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>{it.name}</p>
            <p style={{ margin: 0, color: '#666' }}>{formatCurrency(it.price)}</p>
          </div>
          <input
            type="number"
            min="1"
            max="99"
            value={it.quantity}
            onChange={(e) => updateQuantity(it.productId, +e.target.value)}
            style={{ width: 60, padding: 4 }}
          />
          <button onClick={() => removeItem(it.productId)}>Eliminar</button>
        </div>
      ))}

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <p style={{ fontSize: 20 }}>
          Total: <strong>{formatCurrency(total)}</strong>
        </p>
        <button onClick={goToCheckout} style={{ padding: '10px 24px', fontSize: 16 }}>
          {user ? 'Proceder al pago' : 'Iniciar sesión para pagar'}
        </button>
      </div>
    </main>
  );
}
# Paso 2.12.7: Actualizar client/src/App.jsx

jsx
// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { useCart } from './hooks/useCart.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ProductListPage from './pages/ProductListPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';
import CartPage from './pages/CartPage.jsx';

function Header() {
  const { count } = useCart();
  return (
    <header style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid #eee', alignItems: 'center' }}>
      <Link to="/" style={{ fontWeight: 'bold' }}>🛒 e_commerce_01</Link>
      <Link to="/products">Catálogo</Link>
      <Link to="/cart" style={{ marginLeft: 'auto' }}>
        Carrito {count > 0 && <strong>({count})</strong>}
      </Link>
    </header>
  );
}

function Layout({ children }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/products" element={<ProductListPage />} />
              <Route path="/product/:id" element={<ProductDetailPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/checkout"
                element={
                  <ProtectedRoute>
                    <div style={{ padding: 24 }}>
                      <h2>Checkout</h2>
                      <p>Implementado en la siguiente fase.</p>
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
✅ Checklist de validación frontend:

□ /products muestra el catálogo con paginación.
□ Clic en producto → /product/:id con detalle.
□ "Añadir al carrito" actualiza el contador del header.
□ Sin login, refrescar /products → el carrito persiste (localStorage).
□ Login con items en carrito de invitado → items aparecen en carrito del servidor (merge).
□ En /cart, cambiar cantidad refleja el nuevo total al instante.
□ Botón "Proceder al pago" sin login → /login y tras login → /checkout.
□ Eliminar todos los items muestra el estado "vacío".
Commit del frontend:

bash
git add client/
git commit -m "feat(client): product catalog and cart UI

- CartContext with guest (localStorage) and auth (server) modes
- Auto-merge of guest cart on login
- ProductListPage with pagination
- ProductDetailPage with quantity selector
- CartPage with quantity update and remove
- Header with live cart counter"
📊 2.13 Resumen Visual de la Fase 2

Flujo de checkout (seguro bajo concurrencia)

text
Cliente                Frontend              Backend
  │                       │                     │
  │── Clic "Pagar" ──────▶│                     │
  │                       │── POST /orders/checkout ──▶│
  │                       │                     │
  │                       │              ┌──────▼──────────────┐
  │                       │              │ startTransaction    │
  │                       │              │ read cart           │
  │                       │              │ for each item:      │
  │                       │              │   findOneAndUpdate  │
  │                       │              │   ({stock ≥ qty})   │
  │                       │              │   $inc stock -= qty │
  │                       │              │   if null → abort   │
  │                       │              │ create Order (snap) │
  │                       │              │ clear cart          │
  │                       │              │ commit              │
  │                       │              └──────┬──────────────┘
  │                       │◀──── 201 {order} ───│
  │◀── Orden confirmada ──│                     │
Estados del carrito según el usuario

text
┌────────────────────┬─────────────────────────────────┐
│ Invitado           │ Autenticado                     │
├────────────────────┼─────────────────────────────────┤
│ localStorage       │ MongoDB (Cart collection)       │
│ 'guest_cart'       │ 1 doc por user (unique)         │
│                    │                                 │
│ Al hacer login ───▶│ MERGE: cada item se postea      │
│                    │ al servidor, luego se limpia    │
│                    │ localStorage.                   │
└────────────────────┴─────────────────────────────────┘
