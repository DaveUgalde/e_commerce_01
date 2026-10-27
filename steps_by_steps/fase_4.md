Fase 4 Granular: Pulido UX, Filtros, Admin de Pedidos, Uploads, Tests y Docker

Esta fase profesionaliza el proyecto: cubre el pulido de UX (toasts, skeletons, code-splitting), el manejo de sesión expirada sin perder datos del formulario, filtros de catálogo, la vista admin de pedidos, subida de imágenes con multer, tests automatizados con node:test + supertest, y la dockerización completa.

Lo que construiremos:

#	Módulo	Alcance
1	UX	Toasts globales, skeletons, React.lazy + Suspense
2	Sesión	Manejo centralizado de JWT expirado + preservar formulario
3	Catálogo	Búsqueda, filtro por categoría, precio y orden
4	Admin	Listado de todos los pedidos + cambio de estado
5	Uploads	Subida de imagen de producto con multer (disco local)
6	Tests	node:test + supertest para servicios críticos
7	Deploy	Dockerfile server/client + docker-compose.yml
📦 4.0 Dependencias

Backend

bash
cd server
npm install multer
npm install --save-dev supertest
Añade al package.json de server/:

json
"scripts": {
  "dev": "node --watch src/server.js",
  "start": "node src/server.js",
  "seed": "node src/scripts/seedProducts.js",
  "test": "NODE_OPTIONS='--test-reporter=spec' node --test tests/"
}
Backend .env.example

Añade:

env
# ─── Uploads ─────────────────────────────────────────────
UPLOAD_DIR=uploads
MAX_UPLOAD_MB=2
PUBLIC_URL=http://localhost:3000
Y en .env, copia estos valores.

🎨 4.1 UX: Toasts, Skeletons y Code Splitting

# Paso 4.1.1: Sistema de toasts (client/src/context/ToastContext.jsx)

jsx
// client/src/context/ToastContext.jsx
import { createContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, variant = 'info', duration = 4000) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const toast = {
    success: (msg, dur) => push(msg, 'success', dur),
    error: (msg, dur) => push(msg, 'error', dur ?? 5000),
    info: (msg, dur) => push(msg, 'info', dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 'var(--space-4)',
          right: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          zIndex: 2000,
          maxWidth: 360,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`alert alert--${t.variant === 'error' ? 'error' : t.variant === 'success' ? 'success' : 'info'}`}
            style={{ margin: 0, boxShadow: 'var(--shadow-lg)', cursor: 'pointer' }}
            onClick={() => remove(t.id)}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastContext;
client/src/hooks/useToast.js:

javascript
// client/src/hooks/useToast.js
import { useContext } from 'react';
import ToastContext from '../context/ToastContext.jsx';

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
# Paso 4.1.2: Skeleton loader (client/src/components/Skeleton.jsx)

Añade al components.css:

css
.skeleton {
  background: linear-gradient(90deg, var(--color-bg-muted) 25%, #e9ecef 37%, var(--color-bg-muted) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: var(--radius);
}
@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
jsx
// client/src/components/Skeleton.jsx
export default function Skeleton({ width = '100%', height = 20, style }) {
  return <div className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}
# Paso 4.1.3: Reemplazar spinners por skeletons en ProductListPage

En el paso 4.3 (filtros) reemplazaremos el loading en ProductListPage. Por ahora, crea client/src/components/ProductCardSkeleton.jsx:

jsx
// client/src/components/ProductCardSkeleton.jsx
import Skeleton from './Skeleton.jsx';

export default function ProductCardSkeleton() {
  return (
    <div className="card">
      <Skeleton height={200} />
      <Skeleton height={20} width="80%" style={{ marginTop: 12 }} />
      <Skeleton height={16} width="40%" style={{ marginTop: 8 }} />
      <Skeleton height={36} style={{ marginTop: 16 }} />
    </div>
  );
}
# Paso 4.1.4: Code splitting con React.lazy + Suspense

Actualiza client/src/App.jsx:

jsx
// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Skeleton from './components/Skeleton.jsx';

// ─── Carga diferida: cada página = chunk separado ────────
const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const RegisterPage = lazy(() => import('./pages/RegisterPage.jsx'));
const ProductListPage = lazy(() => import('./pages/ProductListPage.jsx'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage.jsx'));
const CartPage = lazy(() => import('./pages/CartPage.jsx'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage.jsx'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.jsx'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage.jsx'));
const AdminProductsPage = lazy(() => import('./pages/admin/AdminProductsPage.jsx'));
const AdminOrdersPage = lazy(() => import('./pages/admin/AdminOrdersPage.jsx'));

function PageFallback() {
  return (
    <div style={{ padding: 'var(--space-8) 0' }}>
      <Skeleton height={32} width="30%" />
      <Skeleton height={20} width="60%" style={{ marginTop: 12 }} />
      <Skeleton height={200} style={{ marginTop: 24 }} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/products" element={<ProductListPage />} />
                  <Route path="/product/:id" element={<ProductDetailPage />} />
                  <Route path="/cart" element={<CartPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
                  <Route path="/orders" element={<ProtectedRoute><OrderHistoryPage /></ProtectedRoute>} />
                  <Route path="/orders/:id" element={<ProtectedRoute><OrderDetailPage /></ProtectedRoute>} />
                  <Route path="/admin/products" element={<ProtectedRoute requiredRole="admin"><AdminProductsPage /></ProtectedRoute>} />
                  <Route path="/admin/orders" element={<ProtectedRoute requiredRole="admin"><AdminOrdersPage /></ProtectedRoute>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </CartProvider>
    </AuthProvider>
  );
}
Verifica: en la pestaña Network del navegador, al navegar a /products, debe cargarse un chunk .js separado. El bundle inicial ya no incluye todas las páginas.
🔐 4.2 Manejo de Sesión Expirada

# Paso 4.2.1: Centralizar la detección en api.js

Reemplaza client/src/services/api.js:

javascript
// client/src/services/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// Request: adjuntar JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response: manejar 401 centralizado
let expiredDispatched = false; // evitar spam si 3 requests fallan simultáneos
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      if (!expiredDispatched) {
        expiredDispatched = true;
        window.dispatchEvent(new CustomEvent('auth:expired'));
        setTimeout(() => { expiredDispatched = false; }, 1000);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
# Paso 4.2.2: Escuchar el evento en AuthContext

Añade dentro de AuthProvider (en client/src/context/AuthContext.jsx):

jsx
useEffect(() => {
  function onExpired() {
    dispatch({ type: 'LOGOUT' });
  }
  window.addEventListener('auth:expired', onExpired);
  return () => window.removeEventListener('auth:expired', onExpired);
}, []);
Al dispararse auth:expired, el usuario queda como null y <ProtectedRoute> redirige a /login con state.from = ruta actual. Tras re-loguearse, vuelve a donde estaba.
# Paso 4.2.3: Preservar el formulario de checkout

Modifica client/src/pages/CheckoutPage.jsx (añade estos useEffect):

jsx
// client/src/pages/CheckoutPage.jsx — añadir al inicio del componente
const FORM_KEY = 'checkout_form_draft';

// Restaurar borrador al montar
useEffect(() => {
  try {
    const saved = sessionStorage.getItem(FORM_KEY);
    if (saved) setForm(JSON.parse(saved));
  } catch { /* ignore */ }
}, []);

// Persistir cambios del form
useEffect(() => {
  if (Object.values(form).some(Boolean)) {
    sessionStorage.setItem(FORM_KEY, JSON.stringify(form));
  }
}, [form]);

// Limpiar borrador tras pago exitoso (en handleSubmit)
// Antes de navigate, añade:
sessionStorage.removeItem(FORM_KEY);
Flujo end-to-end de expiración:

text
Usuario completa formulario de checkout
       │
       ▼
Hace clic "Pagar" → POST /orders/checkout
       │
       ▼
JWT expirado → 401
       │
       ▼
Interceptor api.js:
  - Borra token de localStorage
  - Emite auth:expired
       │
       ├─▶ AuthContext recibe → user=null
       │        │
       │        ▼
       │   ProtectedRoute detecta user=null → Navigate('/login', {state:{from:'/checkout'}})
       │
       └─▶ Formulario ya persistido en sessionStorage
       │
       ▼
Usuario ve LoginPage
       │
       ▼
Introduce credenciales → login exitoso
       │
       ▼
Navigate('/checkout') ← redirección automática
       │
       ▼
CheckoutPage monta → lee borrador de sessionStorage → form restaurado
       │
       ▼
Usuario reintenta pago ✅
🔍 4.3 Búsqueda, Filtros y Ordenamiento

# Paso 4.3.1: Backend — ampliar product.service.js

Reemplaza listProducts en server/src/services/product.service.js:

javascript
export async function listProducts(query, { isAdmin = false } = {}) {
  const { page, limit, skip } = parsePagination(query);

  const filter = {};
  const includeInactive = query.includeInactive === 'true';
  if (!(isAdmin && includeInactive)) filter.isActive = true;

  if (query.category) filter.category = query.category;

  // Rango de precio
  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
  }

  // Búsqueda por texto
  if (query.q) {
    filter.$or = [
      { name: { $regex: query.q, $options: 'i' } },
      { description: { $regex: query.q, $options: 'i' } },
    ];
  }

  // Ordenamiento permitido (whitelist)
  const SORT_MAP = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    name_asc: { name: 1 },
    name_desc: { name: -1 },
  };
  const sort = SORT_MAP[query.sort] || SORT_MAP.newest;

  const [products, total] = await Promise.all([
    Product.find(filter).sort(sort).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);

  return { products, meta: buildPaginationMeta({ page, limit, total }) };
}

/**
 * Devuelve las categorías únicas de productos activos.
 * Usado por el filtro del catálogo.
 */
export async function listCategories() {
  return Product.distinct('category', { isActive: true });
}
# Paso 4.3.2: Backend — añadir endpoint de categorías

En server/src/controllers/product.controller.js:

javascript
export async function categories(req, res, next) {
  try {
    const categories = await productService.listCategories();
    res.json({ status: 'success', data: { categories } });
  } catch (err) { next(err); }
}
En server/src/routes/product.routes.js:

javascript
router.get('/categories', productController.categories);
// ⚠️ Va ANTES de '/:id' para que no lo capture el param
# Paso 4.3.3: Frontend — barra de filtros

Crea client/src/components/ProductFilters.jsx:

jsx
// client/src/components/ProductFilters.jsx
import { useState, useEffect } from 'react';
import api from '../services/api.js';
import Button from './Button.jsx';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Más recientes' },
  { value: 'price_asc', label: 'Precio: menor a mayor' },
  { value: 'price_desc', label: 'Precio: mayor a menor' },
  { value: 'name_asc', label: 'Nombre A–Z' },
];

export default function ProductFilters({ value, onChange }) {
  const [categories, setCategories] = useState([]);
  const [searchInput, setSearchInput] = useState(value.q || '');

  useEffect(() => {
    api.get('/products/categories')
      .then(({ data }) => setCategories(data.data.categories))
      .catch(() => {});
  }, []);

  // Debounce de la búsqueda
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== value.q) onChange({ ...value, q: searchInput, page: 1 });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, v) {
    onChange({ ...value, [key]: v, page: 1 });
  }

  function reset() {
    setSearchInput('');
    onChange({ q: '', category: '', sort: 'newest', page: 1 });
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--space-6)', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 'var(--space-3)', alignItems: 'end' }}>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="search" className="field__label">Buscar</label>
        <input
          id="search" type="search" className="field__input"
          value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Ej. iPhone, MacBook…"
        />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="category" className="field__label">Categoría</label>
        <select id="category" className="field__input" value={value.category || ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">Todas</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="sort" className="field__label">Ordenar por</label>
        <select id="sort" className="field__input" value={value.sort || 'newest'} onChange={(e) => set('sort', e.target.value)}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <Button variant="secondary" onClick={reset}>Limpiar</Button>
    </div>
  );
}
# Paso 4.3.4: Reescribir ProductListPage

jsx
// client/src/pages/ProductListPage.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useCart } from '../hooks/useCart.js';
import { useToast } from '../hooks/useToast.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import Button from '../components/Button.jsx';
import ProductFilters from '../components/ProductFilters.jsx';
import ProductCardSkeleton from '../components/ProductCardSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';

const DEFAULT_FILTERS = { q: '', category: '', sort: 'newest', page: 1, limit: 12 };

export default function ProductListPage() {
  const [products, setProducts] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { addItem } = useCart();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });

    api.get(`/products?${params}`)
      .then(({ data }) => {
        if (cancelled) return;
        setProducts(data.data.products);
        setMeta(data.data.meta);
      })
      .catch((err) => !cancelled && setError(err.response?.data?.message || 'Error cargando'))
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [filters]);

  async function handleAdd(product) {
    try {
      await addItem(product, 1);
      toast.success(`"${product.name}" añadido al carrito`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'No se pudo añadir');
    }
  }

  return (
    <div>
      <h1>Catálogo</h1>
      <ProductFilters value={filters} onChange={setFilters} />

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          description="No hay productos que coincidan con los filtros."
          action={<Button onClick={() => setFilters(DEFAULT_FILTERS)}>Limpiar filtros</Button>}
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
            {products.map((p) => (
              <article key={p._id} className="card card--interactive" style={{ display: 'flex', flexDirection: 'column' }}>
                <Link to={`/product/${p._id}`}>
                  <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 'var(--radius)' }} />
                </Link>
                <h3 style={{ fontSize: 'var(--text-base)', margin: 'var(--space-3) 0 var(--space-1)' }}>{p.name}</h3>
                <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>{formatCurrency(p.price, p.currency)}</p>
                <p style={{ fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0 var(--space-3)', color: p.stock > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {p.stock > 0 ? `Stock: ${p.stock}` : 'Agotado'}
                </p>
                <Button style={{ marginTop: 'auto' }} onClick={() => handleAdd(p)} disabled={p.stock === 0} fullWidth>
                  Añadir al carrito
                </Button>
              </article>
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <div style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', justifyContent: 'center' }}>
              <Button variant="secondary" disabled={!meta.hasPrev} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Anterior</Button>
              <span>Página {meta.page} de {meta.totalPages} ({meta.total} resultados)</span>
              <Button variant="secondary" disabled={!meta.hasNext} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Siguiente →</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
📋 4.4 Admin de Pedidos

# Paso 4.4.1: Backend — order.service.js (añade funciones)

javascript
// server/src/services/order.service.js — añade al final

const ALLOWED_TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Lista TODOS los pedidos (solo admin) con paginación básica.
 */
export async function listAllOrders({ status, page = 1, limit = 20 }) {
  const filter = status ? { status } : {};
  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { orders, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Actualiza el estado de un pedido respetando la máquina de estados.
 */
export async function updateOrderStatus(orderId, newStatus) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const allowed = ALLOWED_TRANSITIONS[order.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `Transición inválida: ${order.status} → ${newStatus}`,
      409
    );
  }

  order.status = newStatus;
  await order.save();
  return order;
}
# Paso 4.4.2: Backend — controladores y rutas

En server/src/controllers/order.controller.js:

javascript
export async function adminList(req, res, next) {
  try {
    const { orders, meta } = await orderService.listAllOrders(req.query);
    res.json({ status: 'success', data: { orders, meta } });
  } catch (err) { next(err); }
}

export async function adminUpdateStatus(req, res, next) {
  try {
    const order = await orderService.updateOrderStatus(req.params.id, req.body.status);
    res.json({ status: 'success', data: { order } });
  } catch (err) { next(err); }
}
En server/src/routes/order.routes.js (antes del router.use(protect) para no mezclar, o al final con la protección explícita):

javascript
import { protect, admin } from '../middlewares/auth.middleware.js';

// Rutas admin (deben ir ANTES de '/:id' para evitar colisión)
router.get('/admin', protect, admin, orderController.adminList);
router.patch(
  '/admin/:id/status',
  protect, admin,
  [body('status').isIn(['paid', 'shipped', 'delivered', 'cancelled'])],
  validate,
  orderController.adminUpdateStatus
);

// Rutas cliente (ya estaban)
router.post('/checkout', ...);
router.get('/', ...);
router.get('/:id', ...);
# Paso 4.4.3: Frontend — AdminOrdersPage

jsx
// client/src/pages/admin/AdminOrdersPage.jsx
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../hooks/useToast.js';
import { formatCurrency } from '../../utils/formatCurrency.js';
import Badge from '../../components/Badge.jsx';
import Button from '../../components/Button.jsx';
import Alert from '../../components/Alert.jsx';

const STATUS_FILTERS = ['', 'pending', 'paid', 'shipped', 'delivered', 'cancelled'];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = status ? `?status=${status}` : '';
      const { data } = await api.get(`/orders/admin${params}`);
      setOrders(data.data.orders);
    } catch (err) {
      setError(err.response?.data?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(order, newStatus) {
    if (!confirm(`Cambiar estado de #${order._id.slice(-8)} a "${newStatus}"?`)) return;
    try {
      await api.patch(`/orders/admin/${order._id}/status`, { status: newStatus });
      toast.success('Estado actualizado');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'No se pudo actualizar');
    }
  }

  const NEXT_STATUS = {
    pending: ['paid', 'cancelled'],
    paid: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  return (
    <div>
      <h1>Pedidos</h1>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor="status-filter" className="field__label">Filtrar por estado: </label>
        <select id="status-filter" className="field__input" style={{ display: 'inline-block', width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s || 'Todos'}</option>)}
        </select>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? <p>Cargando…</p> : orders.length === 0 ? <p>Sin pedidos.</p> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o._id}>
                  <td><Link to={`/orders/${o._id}`}>#{o._id.slice(-8).toUpperCase()}</Link></td>
                  <td>
                    {o.user?.name}<br />
                    <small style={{ color: 'var(--color-text-muted)' }}>{o.user?.email}</small>
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString('es-ES')}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(o.total)}</td>
                  <td><Badge status={o.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      {(NEXT_STATUS[o.status] || []).map((next) => (
                        <Button key={next} size="sm" variant={next === 'cancelled' ? 'danger' : 'primary'} onClick={() => changeStatus(o, next)}>
                          → {next}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
Añade el enlace en Layout.jsx (junto a "Admin productos"):

jsx
{user?.role === 'admin' && (
  <>
    <NavLink to="/admin/products" style={linkStyle}>Productos</NavLink>
    <NavLink to="/admin/orders" style={linkStyle}>Pedidos</NavLink>
  </>
)}
📸 4.5 Subida de Imágenes

# Paso 4.5.1: Backend — middleware multer

Crea server/src/middlewares/upload.middleware.js:

javascript
// server/src/middlewares/upload.middleware.js
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 2);

// Asegura que el directorio exista
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${unique}${ext}`);
  },
});

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const uploadImage = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new AppError('Solo se permiten imágenes (JPG, PNG, WEBP, GIF)', 400));
    }
    cb(null, true);
  },
}).single('image');
# Paso 4.5.2: Backend — endpoint de subida

Crea server/src/routes/upload.routes.js:

javascript
// server/src/routes/upload.routes.js
import { Router } from 'express';
import { uploadImage } from '../middlewares/upload.middleware.js';
import { protect, admin } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/product-image', protect, admin, (req, res, next) => {
  uploadImage(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ status: 'error', message: 'No se subió archivo' });

    const url = `${process.env.PUBLIC_URL || ''}/uploads/${req.file.filename}`;
    res.status(201).json({ status: 'success', data: { url, filename: req.file.filename } });
  });
});

export default router;
# Paso 4.5.3: Backend — servir estáticos y montar ruta

En server/src/app.js:

javascript
import path from 'node:path';
import express from 'express';
import uploadRoutes from './routes/upload.routes.js';

// Servir la carpeta de uploads como estático
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

// Montar la ruta de subida
app.use('/api/uploads', uploadRoutes);
Y en el error handler global, añade manejo de errores de Multer:

javascript
app.use((err, req, res, next) => {
  // ...código existente...
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ status: 'error', message: `Archivo demasiado grande (máx ${process.env.MAX_UPLOAD_MB || 2}MB)` });
  }
  // ...resto...
});
# Paso 4.5.4: Frontend — subida en ProductForm

Añade al ProductForm.jsx (dentro del form, antes de "URL de imagen"):

jsx
import { useState as useUploadState } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../hooks/useToast.js';

// Dentro del componente:
const [uploading, setUploading] = useState(false);
const toast = useToast();

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
    setForm((prev) => ({ ...prev, imageUrl: data.data.url }));
    toast.success('Imagen subida');
  } catch (err) {
    toast.error(err.response?.data?.message || 'Error subiendo imagen');
  } finally {
    setUploading(false);
    e.target.value = ''; // permite re-subir el mismo archivo
  }
}

// En el JSX, reemplaza el campo imageUrl por:
<div className="field">
  <label className="field__label">Imagen</label>
  <input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
  {uploading && <span className="field__help">Subiendo…</span>}
  {form.imageUrl && (
    <img src={form.imageUrl} alt="Preview" style={{ marginTop: 8, maxWidth: 200, borderRadius: 'var(--radius)' }} />
  )}
  <input
    type="url"
    className="field__input"
    placeholder="…o pega una URL"
    value={form.imageUrl}
    onChange={handleChange}
    name="imageUrl"
    style={{ marginTop: 8 }}
  />
</div>
🧪 4.6 Tests Automatizados

# Paso 4.6.1: Setup de tests

Crea server/tests/setup.js:

javascript
// server/tests/setup.js
import 'dotenv/config';
import mongoose from 'mongoose';

// ⚠️ Usa una BD separada para evitar contaminar dev/prod
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/e_commerce_01_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_that_is_at_least_32_chars';
process.env.NODE_ENV = 'test';

export async function connectTestDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

export async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
  await mongoose.disconnect();
}
Añade a .env.example:

env
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/e_commerce_01_test
# Paso 4.6.2: Tests de auth (server/tests/auth.test.js)

javascript
// server/tests/auth.test.js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { connectTestDb, clearDb, disconnectTestDb } from './setup.js';

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

test('POST /auth/register crea usuario y devuelve token', async () => {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Test User',
    email: 'test@example.com',
    password: 'Password123',
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.data.token);
  assert.equal(res.body.data.user.email, 'test@example.com');
  assert.equal(res.body.data.user.password, undefined, 'no debe exponer password');
});

test('POST /auth/register con email duplicado devuelve 409', async () => {
  const payload = { name: 'A', email: 'dup@example.com', password: 'Password123' };
  await request(app).post('/api/auth/register').send(payload);
  const res = await request(app).post('/api/auth/register').send(payload);
  assert.equal(res.status, 409);
});

test('POST /auth/login con password correcto devuelve token', async () => {
  await request(app).post('/api/auth/register').send({
    name: 'X', email: 'login@example.com', password: 'Password123',
  });
  const res = await request(app).post('/api/auth/login').send({
    email: 'login@example.com', password: 'Password123',
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.token);
});

test('POST /auth/login con password incorrecto devuelve 401 (mismo mensaje)', async () => {
  await request(app).post('/api/auth/register').send({
    name: 'X', email: 'wrong@example.com', password: 'Password123',
  });
  const res = await request(app).post('/api/auth/login').send({
    email: 'wrong@example.com', password: 'Wrong1234',
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.message, 'Credenciales inválidas');
});

test('GET /auth/me sin token devuelve 401', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});
# Paso 4.6.3: Tests de producto (server/tests/product.test.js)

javascript
// server/tests/product.test.js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { connectTestDb, clearDb, disconnectTestDb } from './setup.js';
import User from '../src/models/User.js';
import { signToken } from '../src/utils/jwt.js';

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

async function createAdminToken() {
  const admin = await User.create({
    name: 'Admin', email: 'admin@test.com', password: 'Password123', role: 'admin',
  });
  return signToken({ id: admin._id.toString(), role: admin.role });
}

const validProduct = {
  name: 'Test Product',
  description: 'Descripción válida para test',
  price: 99.99,
  stock: 10,
};

test('GET /products es público y devuelve solo activos', async () => {
  const token = await createAdminToken();
  await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(validProduct);
  await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({ ...validProduct, name: 'Inactivo' });

  const res = await request(app).get('/api/products');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.products.length, 2);
});

test('POST /products sin token → 401', async () => {
  const res = await request(app).post('/api/products').send(validProduct);
  assert.equal(res.status, 401);
});

test('POST /products como user → 403', async () => {
  const user = await User.create({ name: 'U', email: 'u@test.com', password: 'Password123' });
  const token = signToken({ id: user._id.toString(), role: user.role });
  const res = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(validProduct);
  assert.equal(res.status, 403);
});

test('POST /products como admin → 201 con slug generado', async () => {
  const token = await createAdminToken();
  const res = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send(validProduct);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.product.slug, 'test-product');
});
# Paso 4.6.4: Test de concurrencia (server/tests/checkout.test.js)

javascript
// server/tests/checkout.test.js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { connectTestDb, clearDb, disconnectTestDb } from './setup.js';
import User from '../src/models/User.js';
import Product from '../src/models/Product.js';
import { signToken } from '../src/utils/jwt.js';

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const address = {
  street: 'x', city: 'y', state: 'z', postalCode: '1', country: 'US', phone: '1',
};

async function setupUser(email) {
  const user = await User.create({ name: email, email, password: 'Password123' });
  const token = signToken({ id: user._id.toString(), role: user.role });
  return { user, token };
}

test('checkout exitoso decrementa stock y vacía carrito', async () => {
  const { token } = await setupUser('buyer@test.com');
  const product = await Product.create({
    name: 'Reliquia', description: 'Producto para test de checkout', price: 50, stock: 5,
    slug: 'reliquia',
  });

  await request(app).post('/api/cart/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId: product._id.toString(), quantity: 2 });

  const res = await request(app).post('/api/orders/checkout')
    .set('Authorization', `Bearer ${token}`).send({ shippingAddress: address });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.order.total, 100);
  assert.equal(res.body.data.order.status, 'paid');

  const after = await Product.findById(product._id);
  assert.equal(after.stock, 3);

  const cart = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
  assert.equal(cart.body.data.cart.items.length, 0);
});

test('🔥 CONCURRENCIA: stock 1, 10 buyers, solo 1 gana', async () => {
  const product = await Product.create({
    name: 'Única', description: 'Solo hay una unidad', price: 1, stock: 1,
    slug: 'unica',
  });

  // Preparar 10 usuarios con el producto en el carrito
  const tokens = [];
  for (let i = 0; i < 10; i++) {
    const { token } = await setupUser(`racer${i}@test.com`);
    await request(app).post('/api/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: product._id.toString(), quantity: 1 });
    tokens.push(token);
  }

  // Lanzar los 10 checkouts en paralelo
  const results = await Promise.all(
    tokens.map((t) =>
      request(app).post('/api/orders/checkout')
        .set('Authorization', `Bearer ${t}`).send({ shippingAddress: address })
    )
  );

  const success = results.filter((r) => r.status === 201).length;
  const conflicts = results.filter((r) => r.status === 409).length;

  assert.equal(success, 1, 'solo un checkout debe ganar');
  assert.equal(conflicts, 9, 'los otros 9 deben recibir 409');

  const after = await Product.findById(product._id);
  assert.equal(after.stock, 0, 'stock debe quedar en 0');
});
# Paso 4.6.5: Ejecutar tests

bash
cd server
# Asegúrate de tener MongoDB accesible (Atlas o local)
npm test
Salida esperada: todos los ✓ en verde. Si el test de concurrencia falla con success: 2, algo está mal en el decremento atómico de stock (revisa que sea findOneAndUpdate con $gte, no un save() manual).

🐳 4.7 Dockerización

# Paso 4.7.1: server/Dockerfile

dockerfile
# server/Dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p uploads

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
# Paso 4.7.2: client/Dockerfile (multi-stage + nginx)

Crea también client/nginx.conf:

nginx
# client/nginx.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://server:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /uploads/ {
    proxy_pass http://server:3000;
  }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
}
dockerfile
# client/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# Paso 4.7.3: docker-compose.yml en la raíz

yaml
# docker-compose.yml
services:
  mongo:
    image: mongo:7
    restart: unless-stopped
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "rs.status().ok"]
      interval: 10s
      timeout: 5s
      retries: 5

  mongo-init:
    image: mongo:7
    depends_on:
      mongo:
        condition: service_started
    restart: "no"
    entrypoint: >
      bash -c "
      sleep 5 &&
      mongosh --host mongo:27017 --eval 'try { rs.status() } catch(e) { rs.initiate({_id:\"rs0\", members:[{_id:0, host:\"mongo:27017\"}]}) }'
      "

  server:
    build: ./server
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      MONGODB_URI: mongodb://mongo:27017/e_commerce_01?replicaSet=rs0
      JWT_SECRET: ${JWT_SECRET:-please_change_this_secret_32_chars_minimum}
      JWT_EXPIRES_IN: 1h
      CLIENT_ORIGIN: http://localhost:8080
      PUBLIC_URL: http://localhost:8080
      UPLOAD_DIR: uploads
      MAX_UPLOAD_MB: 2
    depends_on:
      mongo-init:
        condition: service_completed_successfully
    volumes:
      - uploads-data:/app/uploads

  client:
    build: ./client
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - server

volumes:
  mongo-data:
  uploads-data:
# Paso 4.7.4: Arrancar todo

bash
# En la raíz del proyecto
docker compose up --build -d
Visita http://localhost:8080. El backend corre en server:3000 (solo accesible dentro de la red Docker; Nginx lo proxea).

Ejecuta el seed dentro del contenedor:

bash
docker compose exec server npm run seed
O crea el primer admin:

bash
docker compose exec server node -e "
import('./src/config/database.js').then(async ({ connectDatabase }) => {
  await connectDatabase();
  const User = (await import('./src/models/User.js')).default;
  await User.create({ name:'Admin', email:'admin@e_commerce_01.com', password:'Admin12345', role:'admin' });
  console.log('✅ Admin creado');
  process.exit(0);
});
"
Añade un client/.dockerignore y server/.dockerignore:

text
node_modules
tests
.env
uploads
*.log
✅ Checklist de validación de Docker:

□ docker compose up --build levanta los 3 servicios (mongo, server, client).
□ http://localhost:8080 carga la SPA.
□ http://localhost:8080/api/products devuelve JSON (proxy funcionando).
□ http://localhost:8080/uploads/... sirve las imágenes subidas.
□ docker compose down detiene todo sin errores.
□ Los datos persisten entre up/down (volúmenes).
✅ 4.8 Checklist de Validación de la Fase 4

UX

□ Toasts aparecen al añadir producto ("Añadido al carrito") y desaparecen solos.
□ Skeletons muestran placeholders animados mientras carga el catálogo.
□ En Network, cada página carga como chunk .js separado (code splitting).
□ Al filtrar por "iPhone", el catálogo se actualiza sin recargar.
Sesión expirada

□ Con el JWT expirado (o borrado de localStorage manualmente), una petición a /orders redirige a /login.
□ Completas el checkout → borras el token en localStorage → clic "Pagar" → te manda a login → tras loguearte, vuelves a /checkout con el formulario intacto.
Filtros

□ Buscar por texto, filtrar por categoría y ordenar por precio funcionan combinadamente.
□ "Limpiar filtros" restaura el estado por defecto.
□ La paginación respeta los filtros aplicados (no vuelve al listado completo).
Admin de pedidos

□ Admin ve todos los pedidos con nombre y email del cliente.
□ Botones de transición solo aparecen si son válidos (pending→paid, paid→shipped, etc.).
□ Transición inválida (ej. delivered→paid) no se ofrece.
□ Filtro por estado funciona.
Uploads

□ En /admin/products, botón "Nuevo producto" permite subir imagen desde el form.
□ Preview de la imagen aparece tras subir.
□ El producto creado muestra la imagen subida en el catálogo.
□ Subir un .exe (renombrado como .jpg) → error 400 "Solo se permiten imágenes…".
□ Subir archivo > 2 MB → error 400 "Archivo demasiado grande…".
Tests

□ cd server && npm test → todos los tests pasan.
□ Test de concurrencia: 1 éxito + 9 conflictos.
Docker

□ docker compose up --build → todo funciona en localhost:8080.
□ Subida de imagen funciona en el contenedor (volumen persistente).
Commit final

bash
git add .
git commit -m "feat: phase 4 — UX polish, filters, admin orders, uploads, tests, docker

- Toast system and Skeleton loaders
- React.lazy + Suspense for per-page code splitting
- Centralized JWT expiry handling with checkout form preservation
- Product filters: search, category, sort
- Admin orders page with state machine transitions
- Image upload via multer (local storage)
- Automated tests with node:test + supertest (including concurrency test)
- Docker multi-stage builds + docker-compose (mongo + server + client)"
📊 4.9 Resumen Visual de la Fase 4

text
┌───────────────────────────────────────────────────────────────┐
│                       PROYECTO e_commerce_01                       │
│                          (post Fase 4)                         │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │  CLIENT     │   │  SERVER      │   │  MONGO (replica) │   │
│  │  React      │──▶│  Express     │──▶│                  │   │
│  │  + Toasts   │   │  + Multer    │   │  Transacciones   │   │
│  │  + Lazy     │   │  + Static    │   │  atómicas ✅      │   │
│  │  + Skeletons│   │  + JWT       │   │                  │   │
│  └─────────────┘   └──────────────┘   └──────────────────┘   │
│        │                  │                                   │
│        │                  ▼                                   │
│        │           ┌──────────────┐                           │
│        │           │  uploads/    │ (imágenes producto)       │
│        │           └──────────────┘                           │
│        │                                                      │
│        ▼                                                      │
│   ┌────────────────┐                                          │
│   │  Tests         │  node:test + supertest                   │
│   │  Auth ✅        │  Concurrency test: 1 éxito / 9 conflictos │
│   │  Products ✅    │                                          │
│   │  Checkout ✅    │                                          │
│   └────────────────┘                                          │
│                                                               │
│   Todo empaquetado en docker-compose → `localhost:8080`       │
└───────────────────────────────────────────────────────────────┘
