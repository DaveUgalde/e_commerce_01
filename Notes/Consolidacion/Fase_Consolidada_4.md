
___________________________________________________________
🎨 FASE 4 — Completar UX, gestión de pedidos y carga de archivos

📖 1. La Historia (El Porqué)

Esta fase hace que la tienda sea utilizable en situaciones reales: encontrar productos, administrar pedidos, ver notificaciones y cargar imágenes. La experiencia mejora, pero las validaciones de seguridad no se trasladan al frontend.

Puntos críticos a entender en esta fase:

Filtros y Paginación: El backend debe interpretar combinaciones de filtros (categoría, rango de precio, orden) de forma consistente. Usamos una whitelist para los parámetros de ordenamiento (sort) para evitar inyecciones NoSQL.
Transiciones de Pedido (Máquina de Estados): Un pedido entregado no puede volver a "pendiente". El servicio valida que la transición sea lógica (pending → confirmed → shipped → delivered) y devuelve un 409 si se intenta saltar un paso.
Carga Segura de Archivos: El archivo enviado por el navegador no es confiable. Validamos el MIME real (no solo la extensión), limitamos el tamaño a 2MB y guardamos con un nombre aleatorio para evitar Path Traversal.
UX (Toasts y Skeletons): Una notificación temporal (Toast) ayuda al usuario, pero no debe ser el único lugar donde aparezca un error. Los Skeletons mejoran la percepción de velocidad.
Code Splitting: Usamos React.lazy y Suspense para que el navegador no descargue toda la aplicación de golpe, sino solo la página que el usuario está viendo.
📋 2. El Checklist (El Qué)

□ Backend: Instalar multer.
□ Backend: Refactorizar listProducts (filtros por precio, orden whitelist).
□ Backend: Añadir listCategories.
□ Backend: Implementar listAllOrders y updateOrderStatus con ALLOWED_TRANSITIONS.
□ Backend: Crear upload.middleware.ts y upload.routes.ts.
□ Backend: Configurar express.static para la carpeta uploads.
□ Backend (Tests): Crear server/tests/product.test.ts.
□ Frontend: Crear ToastContext.tsx y useToast.ts.
□ Frontend: Crear Skeleton.tsx y ProductCardSkeleton.tsx.
□ Frontend: Refactorizar api.ts (control de expiración de sesión).
□ Frontend: Persistir borrador en CheckoutPage.tsx.
□ Frontend: Crear ProductFilters.tsx.
□ Frontend: Crear AdminOrdersPage.tsx.
□ Frontend: Actualizar ProductForm.tsx (subida de archivos).
□ Frontend: Actualizar App.tsx con React.lazy y rutas anidadas.
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 4.1: Backend — Filtros, Búsqueda y Máquina de Estados

Instalación de Dependencias:
___________________________________________________________
cd server
npm install multer
npm install -D @types/multer
___________________________________________________________
Refactorizar server/src/services/product.service.ts
___________________________________________________________
import { ProductModel } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';
import { searchProvider } from './search.interface.js';

export async function listProducts(filters: any = {}) {
  const { category, minPrice, maxPrice, sort, q, page = 1, limit = 12 } = filters;

  // Si hay búsqueda por texto, delegamos al SearchProvider
  if (q) {
    const results = await searchProvider.searchProducts(q);
    return { data: results, total: results.length, page: 1, totalPages: 1 };
  }

  const query: any = { isActive: true };
  if (category) query.category = category;
  if (minPrice || maxPrice) {
    query.price = {};
    if (minPrice) query.price.$gte = Number(minPrice);
    if (maxPrice) query.price.$lte = Number(maxPrice);
  }

  // Whitelist de ordenamiento (seguridad)
  const SORT_MAP: Record<string, any> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    name_asc: { name: 1 },
    name_desc: { name: -1 },
  };
  const sortOption = SORT_MAP[sort as string] || SORT_MAP.newest;

  const skip = (Number(page) - 1) * Number(limit);
  const total = await ProductModel.countDocuments(query);
  const data = await ProductModel.find(query)
    .sort(sortOption)
    .skip(skip)
    .limit(Number(limit))
    .lean();

  return {
    data,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function listCategories() {
  return ProductModel.distinct('category', { isActive: true });
}

// ... (resto de funciones: getProductById, createProduct, updateProduct)
___________________________________________________________
Refactorizar server/src/services/order.service.ts (Añadir máquina de estados)
___________________________________________________________
import { OrderModel } from '../models/Order.js';
import { AppError } from '../utils/AppError.js';

// ... (checkout y listUserOrders existentes)

export async function listAllOrders(filters: any = {}) {
  const query: any = {};
  if (filters.status) query.status = filters.status;
  return OrderModel.find(query).populate('userId', 'name email').sort({ createdAt: -1 });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatus(orderId: string, newStatus: string) {
  const order = await OrderModel.findById(orderId);
  if (!order) throw new AppError(404, 'Pedido no encontrado', 'NOT_FOUND');

  if (!ALLOWED_TRANSITIONS[order.status]?.includes(newStatus)) {
    throw new AppError(409, `Transición inválida: ${order.status} → ${newStatus}`, 'INVALID_TRANSITION');
  }

  order.status = newStatus as any;
  await order.save();
  return order;
}
___________________________________________________________
Actualizar Controladores y Rutas (Admin)
server/src/controllers/order.controller.ts
___________________________________________________________
export async function adminList(req: Request, res: Response, next: NextFunction) {
  try { res.json(await orderService.listAllOrders(req.query)); } catch (e) { next(e); }
}
export async function adminUpdateStatus(req: Request, res: Response, next: NextFunction) {
  try { res.json(await orderService.updateOrderStatus(req.params.id, req.body.status)); } catch (e) { next(e); }
}
___________________________________________________________
server/src/routes/order.routes.ts (Añadir antes de /:id si existiera)
___________________________________________________________
import { admin } from '../middlewares/auth.middleware.js';

orderRouter.get('/admin', protect, admin, ctrl.adminList);
orderRouter.patch('/admin/:id/status', protect, admin, ctrl.adminUpdateStatus);
___________________________________________________________
Paso 4.2: Backend — Subida de Archivos Segura

server/src/middlewares/upload.middleware.ts
___________________________________________________________
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';

const storage = multer.diskStorage({
  destination: process.env.UPLOAD_DIR!, // ej: './uploads'
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const uploadProductImage = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 2) * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes (jpeg, png, webp)'));
    }
    cb(null, true);
  },
}).single('image');
___________________________________________________________
server/src/routes/upload.routes.ts
___________________________________________________________
import { Router } from 'express';
import { uploadProductImage } from '../middlewares/upload.middleware.js';
import { protect, admin } from '../middlewares/auth.middleware.js';

export const uploadRouter = Router();

uploadRouter.post('/product-image', protect, admin, uploadProductImage, (req: any, res) => {
  if (!req.file) return res.status(400).json({ code: 'NO_FILE', message: 'No se subió ningún archivo' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});
___________________________________________________________
Actualizar server/src/app.ts
___________________________________________________________
import { uploadRouter } from './routes/upload.routes.js';
import path from 'node:path';
import express from 'express';

// ... middleware ...
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR!)));
app.use('/api/uploads', uploadRouter);
___________________________________________________________
Paso 4.3: Backend — Tests Profundos

server/tests/product.test.ts
___________________________________________________________
import { test, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';
import { UserModel } from '../src/models/User.js';

let app: any, adminToken: string, userToken: string;

before(async () => {
  app = await createApp();
  // Crear admin
  await UserModel.create({ email: 'admin@test.com', name: 'Admin', password: 'Password1', role: 'admin' });
  const loginAdmin = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'Password1' });
  adminToken = loginAdmin.body.accessToken;

  // Crear user
  await request(app).post('/api/auth/register').send({ email: 'user@test.com', name: 'User', password: 'Password1' });
  const loginUser = await request(app).post('/api/auth/login').send({ email: 'user@test.com', password: 'Password1' });
  userToken = loginUser.body.accessToken;
});

test('listado público funciona', async () => {
  const res = await request(app).get('/api/products');
  assert.equal(res.status, 200);
});

test('crear producto sin token -> 401', async () => {
  const res = await request(app).post('/api/products').send({ name: 'Test', price: 100, stock: 1 });
  assert.equal(res.status, 401);
});

test('crear producto como user -> 403', async () => {
  const res = await request(app).post('/api/products').set('Authorization', `Bearer ${userToken}`).send({ name: 'Test', price: 100, stock: 1 });
  assert.equal(res.status, 403);
});

test('crear producto como admin -> 201 con slug', async () => {
  const res = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Nuevo Gadget', price: 5000, stock: 10 });
  assert.equal(res.status, 201);
  assert.equal(res.body.slug, 'nuevo-gadget');
});
___________________________________________________________
Paso 4.4: Frontend — UX, Toasts y Skeletons

client/src/context/ToastContext.tsx
___________________________________________________________
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

const ToastContext = createContext<any>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<any[]>([]);

  const push = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 9999 }} aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} style={{ background: t.type === 'error' ? '#dc2626' : '#111', color: 'white', padding: '1rem', marginTop: '0.5rem', borderRadius: '4px' }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
___________________________________________________________
client/src/components/Skeleton.tsx
___________________________________________________________
export function ProductCardSkeleton() {
  return (
    <div style={{ background: '#e5e7eb', height: '250px', borderRadius: '8px', animation: 'pulse 1.5s infinite' }}>
      <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`}</style>
    </div>
  );
}
___________________________________________________________
Paso 4.5: Frontend — Filtros y Sesión Expirada

Actualizar client/src/services/api.ts
___________________________________________________________
// ... código anterior ...
let expiredDispatched = false;

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
      if (!expiredDispatched) {
        expiredDispatched = true;
        window.dispatchEvent(new Event('auth:expired'));
        setTimeout(() => { expiredDispatched = false; }, 1000); // Throttle 1s
      }
    }
  }
  return Promise.reject(error);
});
___________________________________________________________
client/src/components/ProductFilters.tsx
___________________________________________________________
import { useState, useEffect } from 'react';

export function ProductFilters({ onChange }: { onChange: (filters: any) => void }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');

  // Debounce para la búsqueda
  useEffect(() => {
    const timer = setTimeout(() => {
      onChange({ q, category, sort });
    }, 350);
    return () => clearTimeout(timer);
  }, [q, category, sort, onChange]);

  return (
    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
      <input placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} style={{ padding: '0.5rem', flex: 1 }} />
      <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '0.5rem' }}>
        <option value="">Todas las categorías</option>
        <option value="Phones">Teléfonos</option>
        <option value="Laptops">Laptops</option>
        <option value="Audio">Audio</option>
      </select>
      <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: '0.5rem' }}>
        <option value="newest">Más nuevos</option>
        <option value="price_asc">Precio: Menor a Mayor</option>
        <option value="price_desc">Precio: Mayor a Menor</option>
      </select>
    </div>
  );
}
___________________________________________________________
Paso 4.6: Frontend — Admin Pedidos y Subida de Archivos

client/src/pages/admin/AdminOrdersPage.tsx
___________________________________________________________
import { useEffect, useState } from 'react';
import { api } from '../../services/api';

const TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);

  const loadOrders = () => api.get('/orders/admin').then(res => setOrders(res.data));
  useEffect(() => { loadOrders(); }, []);

  const handleTransition = async (id: string, status: string) => {
    try {
      await api.patch(`/orders/admin/${id}/status`, { status });
      loadOrders();
    } catch (e) {
      alert('Transición inválida');
    }
  };

  return (
    <div>
      <h1>Pedidos</h1>
      <table style={{ width: '100%', background: 'white' }}>
        <thead><tr><th>ID</th><th>Usuario</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id}>
              <td>#{o.id.slice(-6)}</td>
              <td>{o.userId.name}</td>
              <td>${o.total / 100}</td>
              <td>{o.status}</td>
              <td>
                {TRANSITIONS[o.status]?.map(s => (
                  <button key={s} onClick={() => handleTransition(o.id, s)} style={{ marginRight: '0.5rem' }}>{s}</button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
___________________________________________________________
Actualizar client/src/pages/admin/ProductForm.tsx (Añadir Input de archivo)
___________________________________________________________
import { useState } from 'react';
import { api } from '../../services/api';

export function ProductForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ name: '', price: 0, stock: 0 });
  const [imageUrl, setImageUrl] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await api.post('/uploads/product-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setImageUrl(res.data.imageUrl);
      alert('Imagen subida correctamente');
    } catch (err) {
      alert('Error al subir imagen (max 2MB)');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/products', { ...form, imageUrl, price: Number(form.price), stock: Number(form.stock) });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit}>
      <input placeholder="Nombre" onChange={e => setForm({ ...form, name: e.target.value })} required />
      <input placeholder="Precio (centavos)" type="number" onChange={e => setForm({ ...form, price: Number(e.target.value) })} required />
      <input placeholder="Stock" type="number" onChange={e => setForm({ ...form, stock: Number(e.target.value) })} required />
      <input type="file" accept="image/*" onChange={handleFileUpload} />
      <button type="submit">Guardar</button>
    </form>
  );
}
___________________________________________________________
Paso 4.7: Frontend — Code Splitting en App.tsx

Actualizar client/src/App.tsx
___________________________________________________________
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';

// Lazy loading para mejorar el rendimiento
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const ProductListPage = lazy(() => import('./pages/ProductListPage').then(m => ({ default: m.ProductListPage })));
const CartPage = lazy(() => import('./pages/CartPage').then(m => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then(m => ({ default: m.CheckoutPage })));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage').then(m => ({ default: m.OrderHistoryPage })));
const AdminProductsPage = lazy(() => import('./pages/admin/AdminProductsPage').then(m => ({ default: m.AdminProductsPage })));
const AdminOrdersPage = lazy(() => import('./pages/admin/AdminOrdersPage').then(m => ({ default: m.AdminOrdersPage })));
const AdminSecurityPage = lazy(() => import('./pages/admin/AdminSecurityPage').then(m => ({ default: m.AdminSecurityPage })));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Cargando...</div>}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/products" element={<ProductListPage />} />
                  <Route path="/cart" element={<CartPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  
                  {/* Rutas protegidas de usuario */}
                  <Route element={<ProtectedRoute />}>
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/orders" element={<OrderHistoryPage />} />
                  </Route>

                  {/* Rutas protegidas de admin */}
                  <Route element={<ProtectedRoute requiredRole="admin" />}>
                    <Route path="/admin/products" element={<AdminProductsPage />} />
                    <Route path="/admin/orders" element={<AdminOrdersPage />} />
                    <Route path="/admin/security" element={<AdminSecurityPage />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
___________________________________________________________
🚦 4. Gate 4 (Validación)

No avances a la Fase 5 hasta que se cumplan TODOS estos puntos:

□ Tests Backend: cd server && npm test pasa en verde. El test de product.test.ts valida que sin token da 401, como usuario da 403, y como admin da 201 con slug.
□ Filtros: En el catálogo, filtrar por categoría, ordenar por precio y buscar por texto. Los resultados deben actualizarse y respetar la combinación.
□ Máquina de Estados: Entrar como admin a /admin/orders. Un pedido en estado pending solo debe mostrar los botones confirmed y cancelled. Un pedido delivered no debe mostrar botones.
□ Upload Seguro:
Subir una imagen válida de menos de 2MB: debe guardarse y previsualizarse.
Subir un archivo .txt (aunque lo renombres a .jpg): el servidor debe rechazarlo (MIME).
Subir un archivo de más de 2MB: debe ser rechazado.
□ Skeletons: Mientras la página de productos carga, se deben ver bloques grises (ProductCardSkeleton) en lugar de un vacío.
□ Toasts: Al añadir un producto al carrito, debe aparecer un toast de confirmación que desaparece solo en 3 segundos.
□ Sesión Expirada:
Iniciar sesión.
Ir a DevTools y borrar la cookie refreshToken o poner el expiresIn del token en 1s.
Intentar navegar a una página protegida (ej. /orders).
Debe redirigir al /login sin bucles infinitos (el flag expiredDispatched funciona).
□ Code Splitting: En DevTools (Network), al navegar por diferentes páginas, deben aparecer archivos .js separados (chunks) por cada página en lugar de un solo archivo gigante.