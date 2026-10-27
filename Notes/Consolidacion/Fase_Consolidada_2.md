
___________________________________________________________
🛒 FASE 2 — Construir el catálogo, carrito y pedido local

📖 1. La Historia (El Porqué)

Ahora la tienda necesita vender algo, pero todavía no tiene pago real. Esta fase crea la lógica local del catálogo, el carrito y la orden.

Puntos críticos a entender en esta fase:

El Backend es la única autoridad: El navegador puede enviar IDs y cantidades, pero no decide el precio. El servidor consulta el producto actual, valida el stock, y calcula el total. Usamos centavos (enteros) para evitar errores de redondeo de float.
Concurrencia (La última unidad): Si dos personas compran al mismo tiempo, no podemos permitir sobreventa. Usamos findOneAndUpdate con la condición stock: { $gte: quantity } dentro de una transacción de MongoDB. Una operación gana, la otra falla con 409 Conflict.
Idempotencia: Un usuario puede hacer doble clic en "Pagar" o la red puede fallar. Usamos una Idempotency-Key en el header. Si llega la misma clave, devolvemos la orden original en vez de crear una nueva.
No mezclar pago real: Hasta la Fase 5, el estado del pedido será pending y el estado de pago unpaid. No fingimos que ha sido pagado.
SearchProvider: Para no acoplar la búsqueda a Mongo, definimos una interfaz abstracta. En el futuro (Fase 9), podremos inyectar Meilisearch sin tocar el resto del código.
___________________________________________________________
📋 2. El Checklist (El Qué)

□ Crear shared/types/product.ts, cart.ts y order.ts (ya creados en Fase 0).
□ Modelos: Product.ts, Cart.ts, Order.ts (con índice único en idempotencyKey).
□ Servicios: search.interface.ts, product.service.ts, cart.service.ts, order.service.ts.
□ Controladores: product.controller.ts, cart.controller.ts, order.controller.ts.
□ Rutas: product.routes.ts, cart.routes.ts, order.routes.ts.
□ Modificar app.ts para montar las rutas.
□ Script seedProducts.ts (6 productos, uno con stock bajo).
□ Tests: checkout.test.ts (concurrencia 1x201, 9x409) y checkout-idempotency.test.ts.
□ Frontend: formatCurrency.ts, CartContext.tsx, useCart.ts.
□ Frontend: ProductListPage.tsx, ProductDetailPage.tsx, CartPage.tsx.
□ Actualizar App.tsx (CartProvider, Header, nuevas rutas).
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 2.1: Modelos de Backend
___________________________________________________________
import mongoose, { Schema } from 'mongoose';
import type { Product } from '@shared/product.js';

const productSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'USD' },
  stock: { type: Number, required: true, min: 0, default: 0 },
  imageUrl: { type: String, default: '' },
  category: { type: String, index: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

productSchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  next();
});

export const ProductModel = mongoose.model('Product', productSchema);
___________________________________________________________
server/src/models/Cart.ts
___________________________________________________________
import mongoose, { Schema } from 'mongoose';

const cartSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: [{
    _id: false,
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
  }],
}, { timestamps: true });

export const CartModel = mongoose.model('Cart', cartSchema);
___________________________________________________________
server/src/models/Order.ts
___________________________________________________________
import mongoose, { Schema } from 'mongoose';

const orderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: [{
    _id: false,
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    priceAtPurchase: { type: Number, required: true },
    quantity: { type: Number, required: true },
  }],
  total: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid', 'refunded'], default: 'unpaid' },
  shippingAddress: {
    name: String, street: String, city: String, country: String, phone: String,
  },
  idempotencyKey: { type: String, unique: true, sparse: true },
}, { timestamps: true });

orderSchema.index({ userId: 1, createdAt: -1 });

export const OrderModel = mongoose.model('Order', orderSchema);
___________________________________________________________
Paso 2.2: Servicios (Catálogo y Carrito)

server/src/services/search.interface.ts
___________________________________________________________
import { ProductModel } from '../models/Product.js';

export interface SearchProvider {
  searchProducts(query: string): Promise<any[]>;
}

export class MongoRegexSearchProvider implements SearchProvider {
  async searchProducts(query: string): Promise<any[]> {
    return ProductModel.find({ name: { $regex: query, $options: 'i' }, isActive: true }).lean();
  }
}

export const searchProvider: SearchProvider = new MongoRegexSearchProvider();
___________________________________________________________
server/src/services/product.service.ts
___________________________________________________________
import { ProductModel } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';

export async function listProducts(filters: any = {}) {
  const { category, q } = filters;
  const query: any = { isActive: true };
  if (category) query.category = category;
  if (q) query.name = { $regex: q, $options: 'i' };
  
  return ProductModel.find(query).sort({ createdAt: -1 });
}

export async function getProductById(id: string) {
  const product = await ProductModel.findById(id);
  if (!product || !product.isActive) throw new AppError(404, 'Producto no encontrado', 'NOT_FOUND');
  return product;
}

export async function createProduct(dto: any) {
  const exists = await ProductModel.findOne({ name: dto.name });
  if (exists) throw new AppError(409, 'Producto con ese nombre ya existe', 'DUPLICATE');
  return ProductModel.create(dto);
}

export async function updateProduct(id: string, dto: any) {
  const product = await ProductModel.findByIdAndUpdate(id, dto, { new: true });
  if (!product) throw new AppError(404, 'Producto no encontrado', 'NOT_FOUND');
  return product;
}
___________________________________________________________
server/src/services/cart.service.ts
___________________________________________________________
import { CartModel } from '../models/Cart.js';
import { ProductModel } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';

export async function getCart(userId: string) {
  let cart = await CartModel.findOne({ userId }).populate('items.product');
  if (!cart) {
    cart = await CartModel.create({ userId, items: [] });
  }
  return cart;
}

export async function addItem(userId: string, productId: string, quantity: number) {
  const product = await ProductModel.findById(productId);
  if (!product || !product.isActive) throw new AppError(404, 'Producto no encontrado', 'NOT_FOUND');

  let cart = await CartModel.findOne({ userId });
  if (!cart) cart = new CartModel({ userId, items: [] });

  const itemIndex = cart.items.findIndex(item => item.product.toString() === productId);
  if (itemIndex > -1) {
    cart.items[itemIndex].quantity += quantity;
  } else {
    cart.items.push({ product: product._id, quantity });
  }

  await cart.save();
  return cart.populate('items.product');
}
___________________________________________________________
Paso 2.3: El Servicio de Checkout (Transaccional e Idempotente)

server/src/services/order.service.ts
___________________________________________________________
import mongoose from 'mongoose';
import { CartModel } from '../models/Cart.js';
import { ProductModel } from '../models/Product.js';
import { OrderModel } from '../models/Order.js';
import { AppError } from '../utils/AppError.js';

export async function checkout(userId: string, dto: { shippingAddress: any }, idempotencyKey: string) {
  // 1. Verificación de idempotencia rápida
  const existing = await OrderModel.findOne({ idempotencyKey, userId });
  if (existing) return { order: existing };

  const session = await mongoose.startSession();
  let order: any;

  try {
    await session.withTransaction(async () => {
      // 2. Obtener carrito y poblar productos
      const cart = await CartModel.findOne({ userId }).session(session).populate('items.product');
      if (!cart || cart.items.length === 0) throw new AppError(400, 'Carrito vacío', 'EMPTY_CART');

      let total = 0;
      const items = [];

      // 3. Validar stock y precio en el servidor
      for (const item of cart.items) {
        const product = item.product as any;
        if (!product.isActive) throw new AppError(409, `Producto inactivo: ${product.name}`, 'INACTIVE');

        // Decremento atómico condicional (Evita sobreventa)
        const updated = await ProductModel.findOneAndUpdate(
          { _id: product._id, stock: { $gte: item.quantity }, isActive: true },
          { $inc: { stock: -item.quantity } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, `Stock insuficiente: ${product.name}`, 'OUT_OF_STOCK');

        total += product.price * item.quantity;
        items.push({
          product: product._id,
          name: product.name,
          priceAtPurchase: product.price, // Snapshot del precio
          quantity: item.quantity,
        });
      }

      // 4. Crear la Orden
      const [created] = await OrderModel.create([{
        userId,
        items,
        total,
        status: 'pending',
        paymentStatus: 'unpaid',
        shippingAddress: dto.shippingAddress,
        idempotencyKey,
      }], { session });

      order = created;

      // 5. Vaciar Carrito
      cart.items = [];
      await cart.save({ session });
    });
  } finally {
    await session.endSession();
  }

  return { order };
}

export async function listUserOrders(userId: string) {
  return OrderModel.find({ userId }).sort({ createdAt: -1 });
}
___________________________________________________________
Paso 2.4: Controladores y Rutas

server/src/controllers/product.controller.ts
___________________________________________________________
import type { Request, Response, NextFunction } from 'express';
import * as productService from '../services/product.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try { res.json(await productService.listProducts(req.query)); } catch (e) { next(e); }
}
export async function detail(req: Request, res: Response, next: NextFunction) {
  try { res.json(await productService.getProductById(req.params.id)); } catch (e) { next(e); }
}
export async function create(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await productService.createProduct(req.body)); } catch (e) { next(e); }
}
___________________________________________________________
server/src/controllers/cart.controller.ts
___________________________________________________________
import type { Request, Response, NextFunction } from 'express';
import * as cartService from '../services/cart.service.js';

export async function get(req: Request, res: Response, next: NextFunction) {
  try { res.json(await cartService.getCart((req as any).user.id)); } catch (e) { next(e); }
}
export async function add(req: Request, res: Response, next: NextFunction) {
  try { res.json(await cartService.addItem((req as any).user.id, req.body.productId, req.body.quantity)); } catch (e) { next(e); }
}
___________________________________________________________
server/src/controllers/order.controller.ts
___________________________________________________________
import type { Request, Response, NextFunction } from 'express';
import * as orderService from '../services/order.service.js';

export async function checkout(req: Request, res: Response, next: NextFunction) {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (!idempotencyKey) return res.status(400).json({ code: 'MISSING_HEADER', message: 'Idempotency-Key requerida' });
    
    const result = await orderService.checkout((req as any).user.id, req.body, idempotencyKey);
    res.status(201).json(result);
  } catch (e) { next(e); }
}

export async function history(req: Request, res: Response, next: NextFunction) {
  try { res.json(await orderService.listUserOrders((req as any).user.id)); } catch (e) { next(e); }
}
___________________________________________________________
server/src/routes/product.routes.ts
___________________________________________________________
import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/product.controller.js';
import { protect, admin } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.js';

export const productRouter = Router();

productRouter.get('/', ctrl.list);
productRouter.get('/:id', ctrl.detail);
productRouter.post('/', protect, admin,
  body('name').trim().notEmpty(),
  body('price').isInt({ min: 0 }),
  body('stock').isInt({ min: 0 }),
  validate, ctrl.create
);
___________________________________________________________
server/src/routes/cart.routes.ts
___________________________________________________________
import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/cart.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.js';

export const cartRouter = Router();
cartRouter.use(protect);

cartRouter.get('/', ctrl.get);
cartRouter.post('/',
  body('productId').isMongoId(),
  body('quantity').isInt({ min: 1, max: 99 }),
  validate, ctrl.add
);
___________________________________________________________
server/src/routes/order.routes.ts
___________________________________________________________
import { Router } from 'express';
import { body } from 'express-validator';
import * as ctrl from '../controllers/order.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.js';

export const orderRouter = Router();
orderRouter.use(protect);

orderRouter.post('/checkout',
  body('shippingAddress.name').trim().notEmpty(),
  body('shippingAddress.street').trim().notEmpty(),
  body('shippingAddress.country').trim().notEmpty(),
  validate, ctrl.checkout
);

orderRouter.get('/', ctrl.history);
___________________________________________________________
Modificar server/src/app.ts: (Añadir las rutas)
___________________________________________________________
import { productRouter } from './routes/product.routes.js';
import { cartRouter } from './routes/cart.routes.js';
import { orderRouter } from './routes/order.routes.js';

// ... (después de app.use('/api/auth', authRouter);)
app.use('/api/products', productRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', orderRouter);
___________________________________________________________
Paso 2.5: Script de Seed y Tests

server/src/scripts/seedProducts.ts
___________________________________________________________
import 'dotenv/config';
import mongoose from 'mongoose';
import { ProductModel } from '../models/Product.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';

async function run() {
  await connectDatabase(process.env.MONGODB_URI!);
  await ProductModel.deleteMany({});
  
  await ProductModel.create([
    { name: 'iPhone 15', price: 99900, stock: 10, category: 'Phones' },
    { name: 'MacBook Pro', price: 199900, stock: 5, category: 'Laptops' },
    { name: 'AirPods Pro', price: 24900, stock: 20, category: 'Audio' },
    { name: 'iPad Air', price: 59900, stock: 8, category: 'Tablets' },
    { name: 'Apple Watch', price: 39900, stock: 15, category: 'Wearables' },
    { name: 'Último Teclado', price: 15000, stock: 1, category: 'Accessories' }
  ]);

  console.log('Productos insertados');
  await disconnectDatabase();
}
run();
___________________________________________________________
server/tests/checkout.test.ts (Concurrencia)
___________________________________________________________
import { test, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';
import { ProductModel } from '../src/models/Product.js';
import { UserModel } from '../src/models/User.js';
import { CartModel } from '../src/models/Cart.js';
import { OrderModel } from '../src/models/Order.js';

let app: any, token: string, productId: string;

before(async () => {
  app = await createApp();
  await request(app).post('/api/auth/register').send({ email: 'c@test.com', name: 'C', password: 'Password1' });
  const login = await request(app).post('/api/auth/login').send({ email: 'c@test.com', password: 'Password1' });
  token = login.body.accessToken;

  const user = await UserModel.findOne({ email: 'c@test.com' });
  const product = await ProductModel.create({ name: 'Última', slug: 'ultima', price: 1000, stock: 1, currency: 'USD' });
  productId = product.id;

  await CartModel.create({ userId: user!._id, items: [{ product: product._id, quantity: 1 }] });
});

test('concurrencia: stock 1 + 10 buyers → 1×201, 9×409', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      request(app).post('/api/orders/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `key-${i}`)
        .send({ shippingAddress: { name: 'X', street: 'S', city: 'C', country: 'CO', phone: '1' } })
    )
  );

  const ok = results.filter((r) => r.status === 201).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  assert.equal(ok, 1);
  assert.equal(conflicts, 9);

  const product = await ProductModel.findById(productId);
  assert.equal(product!.stock, 0);
  assert.equal(await OrderModel.countDocuments({}), 1);
});
___________________________________________________________
server/tests/checkout-idempotency.test.ts
___________________________________________________________
import { test, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';
import { ProductModel } from '../src/models/Product.js';
import { UserModel } from '../src/models/User.js';
import { CartModel } from '../src/models/Cart.js';
import { OrderModel } from '../src/models/Order.js';

test('idempotencia: misma key no duplica orden', async () => {
  const app = await createApp();
  await request(app).post('/api/auth/register').send({ email: 'i@test.com', name: 'I', password: 'Password1' });
  const login = await request(app).post('/api/auth/login').send({ email: 'i@test.com', password: 'Password1' });
  const token = login.body.accessToken;

  const user = await UserModel.findOne({ email: 'i@test.com' });
  const product = await ProductModel.create({ name: 'Item', slug: 'item', price: 500, stock: 10, currency: 'USD' });
  await CartModel.create({ userId: user!._id, items: [{ product: product._id, quantity: 1 }] });

  const key = 'fixed-key-123';
  const dto = { shippingAddress: { name: 'X', street: 'S', city: 'C', country: 'CO', phone: '1' } };

  const r1 = await request(app).post('/api/orders/checkout').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(dto);
  const r2 = await request(app).post('/api/orders/checkout').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(dto);

  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(r1.body.order.id, r2.body.order.id);
  assert.equal(await OrderModel.countDocuments({}), 1);
});
___________________________________________________________
Paso 2.6: Frontend (Carrito y Catálogo)
___________________________________________________________
client/src/utils/formatCurrency.ts
___________________________________________________________
export const formatCurrency = (amount: number, currency: string = 'USD') => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
};
___________________________________________________________
client/src/context/CartContext.tsx
___________________________________________________________
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const CartContext = createContext<any>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);

  // Cargar carrito del servidor o de localStorage
  useEffect(() => {
    if (user) {
      api.get('/cart').then(res => setItems(res.data.items || []));
    } else {
      const saved = localStorage.getItem('guest_cart');
      if (saved) setItems(JSON.parse(saved));
    }
  }, [user]);

  // Guardar en localStorage si es invitado
  useEffect(() => {
    if (!user) localStorage.setItem('guest_cart', JSON.stringify(items));
  }, [items, user]);

  const addItem = async (product: any, quantity: number) => {
    if (user) {
      const res = await api.post('/cart', { productId: product.id, quantity });
      setItems(res.data.items);
    } else {
      setItems(prev => {
        const existing = prev.find(i => i.product.id === product.id);
        if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + quantity } : i);
        return [...prev, { product, quantity }];
      });
    }
  };

  const total = items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, total, count }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
___________________________________________________________
client/src/pages/ProductListPage.tsx
___________________________________________________________
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useCart } from '../context/CartContext';
import { formatCurrency } from '../utils/formatCurrency';

export function ProductListPage() {
  const [products, setProducts] = useState<any[]>([]);
  const { addItem } = useCart();

  useEffect(() => {
    api.get('/products').then(res => setProducts(res.data));
  }, []);

  return (
    <div className="page container">
      <h1>Catálogo</h1>
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
        {products.map(p => (
          <div key={p.id} className="card">
            <h3>{p.name}</h3>
            <p>{formatCurrency(p.price)}</p>
            <button className="btn btn-primary" onClick={() => addItem(p, 1)}>Agregar al carrito</button>
          </div>
        ))}
      </div>
    </div>
  );
}
___________________________________________________________
client/src/pages/CartPage.tsx
___________________________________________________________
import { useCart } from '../context/CartContext';
import { formatCurrency } from '../utils/formatCurrency';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

export function CartPage() {
  const { items, total } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleCheckout = () => {
    if (!user) navigate('/login');
    else navigate('/checkout');
  };

  return (
    <div className="page container">
      <h1>Tu Carrito</h1>
      {items.length === 0 ? <p>El carrito está vacío</p> : (
        <>
          {items.map(i => (
            <div key={i.product.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span>{i.product.name} x {i.quantity}</span>
              <span>{formatCurrency(i.product.price * i.quantity)}</span>
            </div>
          ))}
          <h3>Total: {formatCurrency(total)}</h3>
          <button className="btn btn-primary" onClick={handleCheckout}>Proceder al pago</button>
        </>
      )}
    </div>
  );
}
___________________________________________________________
Actualizar client/src/App.tsx (Añadir CartProvider, Header y Rutas)
___________________________________________________________
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider, useCart } from './context/CartContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProductListPage } from './pages/ProductListPage';
import { CartPage } from './pages/CartPage';

// Header con contador del carrito
function Header() {
  const { count } = useCart();
  return (
    <nav style={{ padding: '1rem', display: 'flex', gap: '1rem', background: '#eee' }}>
      <Link to="/">Home</Link>
      <Link to="/products">Productos</Link>
      <Link to="/cart">Carrito ({count})</Link>
      <Link to="/login">Login</Link>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Header />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/products" element={<ProductListPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* Rutas Protegidas */}
            <Route element={<ProtectedRoute requiredRole="admin" />}>
              <Route path="/admin" element={<div>Admin Dashboard</div>} />
            </Route>
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
___________________________________________________________
🚦 4. Gate 2 (Validación)

No avances a la Fase 3 hasta que se cumplan TODOS estos puntos:

□ Tests de Concurrencia: npm test pasa. El test simula 10 compras para 1 solo producto y verifica que exactamente 1 tiene éxito (201) y 9 fallan (409).
□ Test de Idempotencia: npm test verifica que enviar la misma Idempotency-Key devuelve la misma orden y no crea registros duplicados.
□ Carrito Invitado: Añadir productos al carrito sin iniciar sesión. Refrescar la página. El carrito debe persistir (usando localStorage).
□ Carrito Autenticado: Iniciar sesión. El carrito debe viajar al servidor (MongoDB) y mantenerse al cambiar de dispositivo (o al recargar).
□ Autoridad del Servidor: Inspeccionar con DevTools la petición POST /api/orders/checkout. Aunque intentes enviar total: 1, el servidor debe recalcular el precio y guardar el total real (ej. 99900 centavos).
□ Precio en Centavos: En la base de datos, el campo price es un número entero (ej. 99900 para $999.00) y el frontend usa formatCurrency para mostrarlo correctamente.
□ Navegación: "Proceder al pago" sin login redirige a /login. Con login, va a /checkout (puedes dejar el placeholder por ahora).
□ Shared Types: Los modelos backend (Product, Cart, Order) importan correctamente de @shared/types/....