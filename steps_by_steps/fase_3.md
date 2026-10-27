Fase 3 Granular: Checkout, Historial, Panel Admin y Sistema de Diseño

Esta fase cierra el ciclo de compra del usuario y entrega las herramientas de gestión al administrador. También introduce un sistema de diseño ligero que da consistencia visual a toda la app (los estilos inline de fases anteriores se reemplazan por componentes reutilizables).

Lo que construiremos:

Sistema de diseño: tokens CSS, componentes base (Button, Input, Card, Alert, Badge, Spinner, EmptyState, Modal).
Layout unificado: header con navegación condicional por rol, <Outlet /> de React Router.
CheckoutPage: formulario de envío con errores por campo (mapeo del backend).
OrderDetailPage: confirmación tras pago y detalle de cualquier pedido.
OrderHistoryPage: historial de pedidos con badges de estado.
AdminProductsPage: CRUD de productos con modal de edición.
Pequeño ajuste backend: optionalAuth para que el admin vea productos inactivos.
E2E completo con curl del flujo de compra + admin.
🎨 3.1 Sistema de Diseño

# Paso 3.1.1: Crear client/src/styles/theme.css

css
/* client/src/styles/theme.css */
:root {
  /* ─── Colores ─────────────────────────────────────── */
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-light: #dbeafe;
  --color-danger: #dc2626;
  --color-danger-hover: #b91c1c;
  --color-danger-light: #fee2e2;
  --color-success: #16a34a;
  --color-success-light: #dcfce7;
  --color-warning: #d97706;
  --color-warning-light: #fef3c7;
  --color-info: #0891b2;
  --color-info-light: #cffafe;

  --color-bg: #ffffff;
  --color-bg-subtle: #f9fafb;
  --color-bg-muted: #f3f4f6;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-text: #111827;
  --color-text-muted: #6b7280;
  --color-text-subtle: #9ca3af;

  /* ─── Espaciado (escala 4px) ──────────────────────── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* ─── Tipografía ──────────────────────────────────── */
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, monospace;

  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 16px;
  --text-lg: 18px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-3xl: 30px;

  /* ─── Radios y sombras ───────────────────────────── */
  --radius-sm: 4px;
  --radius: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);

  /* ─── Transiciones ───────────────────────────────── */
  --transition: 150ms ease-in-out;
}
# Paso 3.1.2: Crear client/src/styles/components.css

css
/* client/src/styles/components.css */

/* ─── Button ────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius);
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition),
    color var(--transition), opacity var(--transition);
  text-decoration: none;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn--sm { padding: var(--space-1) var(--space-3); font-size: var(--text-sm); }
.btn--md { padding: var(--space-2) var(--space-4); font-size: var(--text-base); }
.btn--lg { padding: var(--space-3) var(--space-6); font-size: var(--text-lg); }
.btn--full { width: 100%; }

.btn--primary { background: var(--color-primary); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--color-primary-hover); }

.btn--secondary { background: var(--color-bg); border-color: var(--color-border-strong); color: var(--color-text); }
.btn--secondary:hover:not(:disabled) { background: var(--color-bg-muted); }

.btn--danger { background: var(--color-danger); color: #fff; }
.btn--danger:hover:not(:disabled) { background: var(--color-danger-hover); }

.btn--ghost { background: transparent; color: var(--color-primary); }
.btn--ghost:hover:not(:disabled) { background: var(--color-primary-light); }

/* ─── Input / FormField ─────────────────────────────────── */
.field { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4); }
.field__label { font-size: var(--text-sm); font-weight: 500; color: var(--color-text); }
.field__label--required::after { content: ' *'; color: var(--color-danger); }
.field__input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--text-base);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.field__input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}
.field__input--error { border-color: var(--color-danger); }
.field__input--error:focus { box-shadow: 0 0 0 3px var(--color-danger-light); }
.field__error { font-size: var(--text-sm); color: var(--color-danger); }
.field__help { font-size: var(--text-sm); color: var(--color-text-muted); }

/* ─── Card ──────────────────────────────────────────────── */
.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
}
.card--interactive { transition: box-shadow var(--transition), transform var(--transition); }
.card--interactive:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }

/* ─── Alert ─────────────────────────────────────────────── */
.alert {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  margin-bottom: var(--space-4);
}
.alert--error { background: var(--color-danger-light); color: var(--color-danger-hover); }
.alert--success { background: var(--color-success-light); color: var(--color-success); }
.alert--info { background: var(--color-info-light); color: var(--color-info); }
.alert--warning { background: var(--color-warning-light); color: var(--color-warning); }

/* ─── Badge ─────────────────────────────────────────────── */
.badge {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.badge--default { background: var(--color-bg-muted); color: var(--color-text-muted); }
.badge--success { background: var(--color-success-light); color: var(--color-success); }
.badge--warning { background: var(--color-warning-light); color: var(--color-warning); }
.badge--info { background: var(--color-info-light); color: var(--color-info); }
.badge--danger { background: var(--color-danger-light); color: var(--color-danger); }

/* ─── Spinner ───────────────────────────────────────────── */
.spinner {
  display: inline-block;
  width: 20px; height: 20px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Modal ─────────────────────────────────────────────── */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: var(--space-4);
}
.modal {
  background: var(--color-bg);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  max-width: 560px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

/* ─── Layout ────────────────────────────────────────────── */
.container { max-width: 1100px; margin: 0 auto; padding: 0 var(--space-4); }
.page { padding: var(--space-8) 0; min-height: calc(100vh - 64px); }

/* ─── Tabla (admin) ─────────────────────────────────────── */
.table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.table th, .table td { padding: var(--space-3); text-align: left; border-bottom: 1px solid var(--color-border); }
.table th { background: var(--color-bg-subtle); font-weight: 600; }
.table tr:hover td { background: var(--color-bg-subtle); }
# Paso 3.1.3: Reemplazar client/src/index.css

css
/* client/src/index.css */
@import './styles/theme.css';
@import './styles/components.css';

*,
*::before,
*::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root { height: 100%; }

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--color-text);
  background: var(--color-bg-subtle);
  -webkit-font-smoothing: antialiased;
}

a { color: var(--color-primary); text-decoration: none; }
a:hover { text-decoration: underline; }

h1 { font-size: var(--text-3xl); margin-bottom: var(--space-4); }
h2 { font-size: var(--text-2xl); margin-bottom: var(--space-3); }
h3 { font-size: var(--text-lg); margin-bottom: var(--space-2); }

code, pre { font-family: var(--font-mono); }
# Paso 3.1.4: Crear componentes base

client/src/components/Button.jsx

jsx
// client/src/components/Button.jsx
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth && 'btn--full',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
client/src/components/FormField.jsx

jsx
// client/src/components/FormField.jsx
export default function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  error,
  help,
  required,
  ...rest
}) {
  const inputClasses = ['field__input', error && 'field__input--error'].filter(Boolean).join(' ');

  return (
    <div className="field">
      {label && (
        <label htmlFor={id} className={`field__label ${required ? 'field__label--required' : ''}`}>
          {label}
        </label>
      )}
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={onChange}
        className={inputClasses}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        {...rest}
      />
      {error && <span id={`${id}-error`} className="field__error" role="alert">{error}</span>}
      {!error && help && <span id={`${id}-help`} className="field__help">{help}</span>}
    </div>
  );
}
client/src/components/Alert.jsx

jsx
// client/src/components/Alert.jsx
export default function Alert({ variant = 'error', children }) {
  return <div className={`alert alert--${variant}`} role="alert">{children}</div>;
}
client/src/components/Badge.jsx

jsx
// client/src/components/Badge.jsx
const STATUS_MAP = {
  pending: { variant: 'warning', label: 'Pendiente' },
  paid: { variant: 'success', label: 'Pagado' },
  shipped: { variant: 'info', label: 'Enviado' },
  delivered: { variant: 'success', label: 'Entregado' },
  cancelled: { variant: 'danger', label: 'Cancelado' },
};

export default function Badge({ status, children }) {
  const config = STATUS_MAP[status] || { variant: 'default', label: status };
  return <span className={`badge badge--${config.variant}`}>{children || config.label}</span>;
}
client/src/components/EmptyState.jsx

jsx
// client/src/components/EmptyState.jsx
export default function EmptyState({ title, description, action }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
      <h3>{title}</h3>
      {description && <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>{description}</p>}
      {action}
    </div>
  );
}
client/src/components/Modal.jsx

jsx
// client/src/components/Modal.jsx
import { useEffect } from 'react';

export default function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 24 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
🏗️ 3.2 Layout Unificado

# Paso 3.2.1: Crear client/src/components/Layout.jsx

jsx
// client/src/components/Layout.jsx
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useCart } from '../hooks/useCart.js';

export default function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/', { replace: true });
  }

  const linkStyle = ({ isActive }) => ({
    color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
    fontWeight: isActive ? 600 : 400,
    textDecoration: 'none',
  });

  return (
    <>
      <header style={{
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)',
        padding: 'var(--space-3) 0',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>
            🛒 e_commerce_01
          </Link>
          <nav style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flex: 1 }}>
            <NavLink to="/products" style={linkStyle}>Catálogo</NavLink>
            {user && <NavLink to="/orders" style={linkStyle}>Mis pedidos</NavLink>}
            {user?.role === 'admin' && <NavLink to="/admin/products" style={linkStyle}>Admin</NavLink>}
          </nav>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <NavLink to="/cart" style={{ color: 'var(--color-text)', textDecoration: 'none' }}>
              🛒 {count > 0 && <strong>({count})</strong>}
            </NavLink>
            {user ? (
              <>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{user.name}</span>
                <button onClick={handleLogout} className="btn btn--secondary btn--sm">Salir</button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="btn btn--secondary btn--sm">Entrar</NavLink>
                <NavLink to="/register" className="btn btn--primary btn--sm">Registrarse</NavLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  );
}
# Paso 3.2.2: Actualizar client/src/pages/HomePage.jsx (landing)

jsx
// client/src/pages/HomePage.jsx
import { Link } from 'react-router-dom';
import Button from '../components/Button.jsx';

export default function HomePage() {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-12) 0' }}>
      <h1 style={{ fontSize: 'var(--text-3xl)' }}>Bienvenido a e_commerce_01</h1>
      <p style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-6)' }}>
        La mejor selección de productos tecnológicos, directo a tu puerta.
      </p>
      <Link to="/products">
        <Button size="lg">Explorar catálogo</Button>
      </Link>
    </div>
  );
}
# Paso 3.2.3: Actualizar client/src/App.jsx con todas las rutas

jsx
// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ProductListPage from './pages/ProductListPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';
import CartPage from './pages/CartPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import OrderDetailPage from './pages/OrderDetailPage.jsx';
import OrderHistoryPage from './pages/OrderHistoryPage.jsx';
import AdminProductsPage from './pages/admin/AdminProductsPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
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
              <Route
                path="/admin/products"
                element={<ProtectedRoute requiredRole="admin"><AdminProductsPage /></ProtectedRoute>}
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
💳 3.3 CheckoutPage con Errores por Campo

# Paso 3.3.1: Crear client/src/pages/CheckoutPage.jsx

jsx
// client/src/pages/CheckoutPage.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useCart } from '../hooks/useCart.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import Button from '../components/Button.jsx';
import FormField from '../components/FormField.jsx';
import Alert from '../components/Alert.jsx';
import EmptyState from '../components/EmptyState.jsx';

const INITIAL_FORM = {
  street: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  phone: '',
};

export default function CheckoutPage() {
  const { items, total, clearCart, loading: cartLoading } = useCart();
  const navigate = useNavigate();

  const [form, setForm] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [globalError, setGlobalError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Limpiar el error del campo al escribir
    if (fieldErrors[name]) {
      setFieldErrors((prev) => { const copy = { ...prev }; delete copy[name]; return copy; });
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setGlobalError(null);

    try {
      const { data } = await api.post('/orders/checkout', { shippingAddress: form });
      const order = data.data.order;

      // Vaciar el carrito en el cliente (el servidor ya lo vació en la transacción)
      await clearCart();

      // Redirigir al detalle del pedido con flag de "recién creado"
      navigate(`/orders/${order._id}`, {
        replace: true,
        state: { justCreated: true },
      });
    } catch (err) {
      const res = err.response?.data;

      // ─── Errores de validación por campo ────────────────
      // El backend devuelve: { errors: [{ field: 'shippingAddress.street', message }] }
      if (res?.errors) {
        const fe = {};
        res.errors.forEach((e) => {
          // Quitamos el prefijo "shippingAddress." para mapear al campo del form
          const key = e.field.replace(/^shippingAddress\./, '');
          fe[key] = e.message;
        });
        setFieldErrors(fe);
      } else {
        // ─── Error global del negocio (stock, carrito vacío, etc.) ──
        setGlobalError(res?.message || 'Error procesando el pedido');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (cartLoading) return <p>Cargando…</p>;

  if (items.length === 0) {
    return (
      <EmptyState
        title="Tu carrito está vacío"
        description="Añade productos antes de proceder al pago."
        action={<Link to="/products"><Button>Añadir productos</Button></Link>}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 'var(--space-8)', alignItems: 'start' }}>
      <form onSubmit={handleSubmit} noValidate>
        <h2>Dirección de envío</h2>
        {globalError && <Alert variant="error">{globalError}</Alert>}

        <FormField
          id="street" label="Calle y número" required
          value={form.street} onChange={handleChange}
          error={fieldErrors.street}
          autoComplete="street-address"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <FormField
            id="city" label="Ciudad" required
            value={form.city} onChange={handleChange}
            error={fieldErrors.city}
            autoComplete="address-level2"
          />
          <FormField
            id="state" label="Estado / Provincia" required
            value={form.state} onChange={handleChange}
            error={fieldErrors.state}
            autoComplete="address-level1"
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <FormField
            id="postalCode" label="Código postal" required
            value={form.postalCode} onChange={handleChange}
            error={fieldErrors.postalCode}
            autoComplete="postal-code"
          />
          <FormField
            id="country" label="País" required
            value={form.country} onChange={handleChange}
            error={fieldErrors.country}
            autoComplete="country-name"
          />
        </div>
        <FormField
          id="phone" label="Teléfono" type="tel" required
          value={form.phone} onChange={handleChange}
          error={fieldErrors.phone}
          help="Con código de país, ej. +1 555 123 4567"
          autoComplete="tel"
        />

        <Button type="submit" size="lg" loading={submitting} disabled={submitting}>
          Pagar {formatCurrency(total)}
        </Button>
      </form>

      {/* ─── Resumen del pedido ─────────────────────────── */}
      <aside className="card">
        <h3>Resumen</h3>
        {items.map((it) => (
          <div key={it.productId} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)' }}>
            <span>{it.name} × {it.quantity}</span>
            <strong>{formatCurrency(it.price * it.quantity)}</strong>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-4)', fontSize: 'var(--text-lg)' }}>
          <span>Total</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
      </aside>
    </div>
  );
}
Cómo se mapean los errores del backend:

Respuesta backend	Frontend muestra
{ errors: [{ field: 'shippingAddress.street', message: 'Calle requerida' }] }	<FormField id="street" error="Calle requerida" />
{ message: 'Stock insuficiente para "iPhone"' }	<Alert variant="error">Stock insuficiente…</Alert>
El .replace(/^shippingAddress\./, '') convierte shippingAddress.street → street, que es el id/name del input.

📄 3.4 OrderDetailPage (Confirmación y Detalle)

# Paso 3.4.1: Crear client/src/pages/OrderDetailPage.jsx

jsx
// client/src/pages/OrderDetailPage.jsx
import { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import api from '../services/api.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import Alert from '../components/Alert.jsx';
import Badge from '../components/Badge.jsx';
import Button from '../components/Button.jsx';

export default function OrderDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const justCreated = location.state?.justCreated;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get(`/orders/${id}`)
      .then(({ data }) => setOrder(data.data.order))
      .catch((err) => setError(err.response?.data?.message || 'Error cargando pedido'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p>Cargando…</p>;
  if (error || !order) return <Alert variant="error">{error || 'Pedido no encontrado'}</Alert>;

  return (
    <div style={{ maxWidth: 800 }}>
      {justCreated && (
        <Alert variant="success">
          ✅ ¡Pedido realizado con éxito! Te contactaremos pronto para coordinar el envío.
        </Alert>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h1 style={{ margin: 0 }}>Pedido #{order._id.slice(-8).toUpperCase()}</h1>
        <Badge status={order.status} />
      </div>

      <p style={{ color: 'var(--color-text-muted)' }}>
        Realizado el {new Date(order.createdAt).toLocaleString('es-ES')}
      </p>

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h3>Productos</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th style={{ textAlign: 'right' }}>Precio</th>
              <th style={{ textAlign: 'center' }}>Cantidad</th>
              <th style={{ textAlign: 'right' }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.product}>
                <td>{it.name}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(it.priceAtPurchase)}</td>
                <td style={{ textAlign: 'center' }}>{it.quantity}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(it.priceAtPurchase * it.quantity)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(order.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h3>Dirección de envío</h3>
        <p>{order.shippingAddress.street}</p>
        <p>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
        <p>{order.shippingAddress.country}</p>
        <p>📞 {order.shippingAddress.phone}</p>
      </div>

      <Link to="/orders"><Button variant="secondary">← Volver a mis pedidos</Button></Link>
    </div>
  );
}
📜 3.5 OrderHistoryPage

# Paso 3.5.1: Crear client/src/pages/OrderHistoryPage.jsx

jsx
// client/src/pages/OrderHistoryPage.jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import Badge from '../components/Badge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Button from '../components/Button.jsx';
import Alert from '../components/Alert.jsx';

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/orders')
      .then(({ data }) => setOrders(data.data.orders))
      .catch((err) => setError(err.response?.data?.message || 'Error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Cargando pedidos…</p>;
  if (error) return <Alert variant="error">{error}</Alert>;

  if (orders.length === 0) {
    return (
      <EmptyState
        title="Aún no tienes pedidos"
        description="Cuando realices tu primera compra, aparecerá aquí."
        action={<Link to="/products"><Button>Ver catálogo</Button></Link>}
      />
    );
  }

  return (
    <div>
      <h1>Mis pedidos</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {orders.map((order) => (
          <Link
            key={order._id}
            to={`/orders/${order._id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className="card card--interactive" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 'var(--space-4)', alignItems: 'center' }}>
              <div>
                <strong>#{order._id.slice(-8).toUpperCase()}</strong>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
                  {new Date(order.createdAt).toLocaleDateString('es-ES')} · {order.items.length} {order.items.length === 1 ? 'producto' : 'productos'}
                </p>
              </div>
              <Badge status={order.status} />
              <strong>{formatCurrency(order.total)}</strong>
              <span style={{ color: 'var(--color-primary)' }}>→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
🛠️ 3.6 Panel Admin de Productos

# Paso 3.6.1: Ajuste backend — optionalAuth para listar inactivos

server/src/middlewares/auth.middleware.js (añadir al final):

javascript
/**
 * Carga req.user si hay token válido; si no, continúa como anónimo.
 * Útil para endpoints públicos con comportamiento extendido por rol.
 */
export async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();
    const token = header.split(' ')[1];
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);
    if (user) req.user = user;
    next();
  } catch {
    next(); // token inválido → anónimo (no rompemos la petición pública)
  }
}
server/src/services/product.service.js — reemplaza listProducts:

javascript
export async function listProducts(query, { isAdmin = false } = {}) {
  const { page, limit, skip } = parsePagination(query);

  const filter = {};
  const includeInactive = query.includeInactive === 'true';

  // Solo admins con flag explícito pueden ver inactivos
  if (!(isAdmin && includeInactive)) {
    filter.isActive = true;
  }

  if (query.category) filter.category = query.category;
  if (query.q) {
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
server/src/controllers/product.controller.js — actualiza list:

javascript
export async function list(req, res, next) {
  try {
    const isAdmin = req.user?.role === 'admin';
    const { products, meta } = await productService.listProducts(req.query, { isAdmin });
    res.json({ status: 'success', data: { products, meta } });
  } catch (err) { next(err); }
}
server/src/routes/product.routes.js — añade optionalAuth al listado:

javascript
import { protect, admin, optionalAuth } from '../middlewares/auth.middleware.js';
// ...
router.get('/', optionalAuth, productController.list);
Con esto, un admin puede pedir GET /api/products?includeInactive=true y ver tanto activos como soft-deleted.
# Paso 3.6.2: Crear client/src/pages/admin/ProductForm.jsx

jsx
// client/src/pages/admin/ProductForm.jsx
import { useState } from 'react';
import FormField from '../../components/FormField.jsx';
import Button from '../../components/Button.jsx';

const EMPTY = {
  name: '', description: '', price: '', stock: '',
  imageUrl: '', category: 'general', currency: 'USD',
};

export default function ProductForm({ initial, onSave, onCancel, submitting }) {
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    description: initial.description,
    price: String(initial.price),
    stock: String(initial.stock),
    imageUrl: initial.imageUrl || '',
    category: initial.category || 'general',
    currency: initial.currency || 'USD',
  } : EMPTY);

  const [errors, setErrors] = useState({});

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((p) => { const c = { ...p }; delete c[name]; return c; });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      stock: Number(form.stock),
      imageUrl: form.imageUrl.trim(),
      category: form.category.trim() || 'general',
      currency: form.currency,
    };
    try {
      await onSave(payload);
    } catch (err) {
      const res = err.response?.data;
      if (res?.errors) {
        const fe = {};
        res.errors.forEach((er) => { fe[er.field] = er.message; });
        setErrors(fe);
      } else {
        setErrors({ _global: res?.message || 'Error guardando producto' });
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {errors._global && <div className="alert alert--error">{errors._global}</div>}

      <FormField id="name" label="Nombre" required value={form.name} onChange={handleChange} error={errors.name} />
      <div className="field">
        <label htmlFor="description" className="field__label field__label--required">Descripción</label>
        <textarea
          id="description" name="description" value={form.description} onChange={handleChange}
          rows={4} className={`field__input ${errors.description ? 'field__input--error' : ''}`}
        />
        {errors.description && <span className="field__error">{errors.description}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
        <FormField id="price" label="Precio" type="number" min="0" step="0.01" required value={form.price} onChange={handleChange} error={errors.price} />
        <FormField id="stock" label="Stock" type="number" min="0" step="1" required value={form.stock} onChange={handleChange} error={errors.stock} />
        <FormField id="currency" label="Moneda" value={form.currency} onChange={handleChange} error={errors.currency} />
      </div>
      <FormField id="category" label="Categoría" value={form.category} onChange={handleChange} error={errors.category} help="Ej. smartphones, laptops" />
      <FormField id="imageUrl" label="URL de imagen" type="url" value={form.imageUrl} onChange={handleChange} error={errors.imageUrl} />

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={submitting}>{initial ? 'Guardar cambios' : 'Crear producto'}</Button>
      </div>
    </form>
  );
}
# Paso 3.6.3: Crear client/src/pages/admin/AdminProductsPage.jsx

jsx
// client/src/pages/admin/AdminProductsPage.jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';
import { formatCurrency } from '../../utils/formatCurrency.js';
import Button from '../../components/Button.jsx';
import Badge from '../../components/Badge.jsx';
import Alert from '../../components/Alert.jsx';
import Modal from '../../components/Modal.jsx';
import ProductForm from './ProductForm.jsx';

export default function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null=crear, object=editar
  const [submitting, setSubmitting] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products?includeInactive=true&limit=100');
      setProducts(data.data.products);
    } catch (err) {
      setError(err.response?.data?.message || 'Error cargando productos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  function openCreate() { setEditing(null); setModalOpen(true); }
  function openEdit(p) { setEditing(p); setModalOpen(true); }
  function closeModal() { setModalOpen(false); setEditing(null); }

  async function handleSave(payload) {
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/products/${editing._id}`, payload);
      } else {
        await api.post('/products', payload);
      }
      closeModal();
      await loadProducts();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(product) {
    if (!window.confirm(`¿Desactivar "${product.name}"? Los pedidos históricos no se verán afectados.`)) return;
    try {
      await api.delete(`/products/${product._id}`);
      await loadProducts();
    } catch (err) {
      setError(err.response?.data?.message || 'Error desactivando producto');
    }
  }

  async function handleReactivate(product) {
    try {
      await api.put(`/products/${product._id}`, { isActive: true });
      await loadProducts();
    } catch (err) {
      setError(err.response?.data?.message || 'Error reactivando producto');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h1 style={{ margin: 0 }}>Productos</h1>
        <Button onClick={openCreate}>+ Nuevo producto</Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p._id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />}
                      <strong>{p.name}</strong>
                    </div>
                  </td>
                  <td>{p.category}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(p.price, p.currency)}</td>
                  <td style={{ textAlign: 'right' }}>{p.stock}</td>
                  <td>
                    <Badge status={p.isActive ? 'paid' : 'cancelled'}>
                      {p.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Editar</Button>
                      {p.isActive ? (
                        <Button size="sm" variant="danger" onClick={() => handleDelete(p)}>Desactivar</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => handleReactivate(p)}>Reactivar</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Editar producto' : 'Nuevo producto'}>
        <ProductForm
          initial={editing}
          onSave={handleSave}
          onCancel={closeModal}
          submitting={submitting}
        />
      </Modal>
    </div>
  );
}
✅ 3.7 Testing E2E con curl

Reinicia el backend y asegúrate de tener al menos un admin (ver Fase 1, prueba 11).

Script unificado que valida el flujo completo del cliente + del admin:

bash
#!/usr/bin/env bash
# e_commerce_01-e2e.sh
set -e
BASE=http://localhost:3000/api

echo "──────────────────────────────────────────────"
echo "▶ 1. Registrar usuario nuevo"
echo "──────────────────────────────────────────────"
EMAIL="e2e_$(date +%s)@example.com"
curl -s -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d "{\"name\":\"E2E User\",\"email\":\"$EMAIL\",\"password\":\"Password123\"}" > /dev/null
echo "  ✓ $EMAIL"

echo "──────────────────────────────────────────────"
echo "▶ 2. Login del cliente"
echo "──────────────────────────────────────────────"
LOGIN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Password123\"}")
UTOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "  ✓ token obtenido: ${UTOKEN:0:20}…"

echo "──────────────────────────────────────────────"
echo "▶ 3. Catálogo público (primeros 3)"
echo "──────────────────────────────────────────────"
curl -s "$BASE/products?limit=3" | jq -r '.data.products[] | "  • \(.name) — $\(.price) (stock: \(.stock))"'

PRODUCT_ID=$(curl -s "$BASE/products?limit=1" | jq -r '.data.products[0]._id')
echo "  Producto de prueba: $PRODUCT_ID"

echo "──────────────────────────────────────────────"
echo "▶ 4. Añadir 2 unidades al carrito"
echo "──────────────────────────────────────────────"
curl -s -X POST $BASE/cart/items -H "Authorization: Bearer $UTOKEN" -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}" | jq -r '"  ✓ carrito con \(.data.cart.items | length) item(s), total $\(.data.cart.total)"'

echo "──────────────────────────────────────────────"
echo "▶ 5. Checkout con dirección válida"
echo "──────────────────────────────────────────────"
ORDER=$(curl -s -X POST $BASE/orders/checkout -H "Authorization: Bearer $UTOKEN" -H "Content-Type: application/json" \
  -d '{"shippingAddress":{"street":"Calle Falsa 123","city":"Springfield","state":"IL","postalCode":"62704","country":"US","phone":"+1 555 123 4567"}}')
ORDER_ID=$(echo "$ORDER" | jq -r '.data.order._id')
echo "  ✓ orden creada: ${ORDER_ID: -8}"
echo "$ORDER" | jq -r '"  • status: \(.data.order.status) · total: $\(.data.order.total)"'

echo "──────────────────────────────────────────────"
echo "▶ 6. Verificar decremento de stock"
echo "──────────────────────────────────────────────"
curl -s $BASE/products/$PRODUCT_ID | jq -r '"  stock ahora: \(.data.product.stock)"'

echo "──────────────────────────────────────────────"
echo "▶ 7. Verificar carrito vacío"
echo "──────────────────────────────────────────────"
CART_LEN=$(curl -s $BASE/cart -H "Authorization: Bearer $UTOKEN" | jq '.data.cart.items | length')
echo "  items en carrito: $CART_LEN"

echo "──────────────────────────────────────────────"
echo "▶ 8. Historial del cliente"
echo "──────────────────────────────────────────────"
curl -s $BASE/orders -H "Authorization: Bearer $UTOKEN" | jq -r '"  pedidos: \(.data.orders | length)"'

echo "──────────────────────────────────────────────"
echo "▶ 9. Detalle del pedido"
echo "──────────────────────────────────────────────"
curl -s $BASE/orders/$ORDER_ID -H "Authorization: Bearer $UTOKEN" | jq -r '"  #\(.data.order._id[-8:]) · \(.data.order.items | length) item(s) · total $\(.data.order.total)"'

echo "──────────────────────────────────────────────"
echo "▶ 10. Admin: login y listar productos (incluye inactivos)"
echo "──────────────────────────────────────────────"
# ⚠️ CAMBIA ESTAS CREDENCIALES POR LAS DE TU ADMIN
ATOKEN=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"Password123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
TOTAL_ALL=$(curl -s "$BASE/products?includeInactive=true&limit=100" -H "Authorization: Bearer $ATOKEN" | jq '.data.products | length')
TOTAL_ACTIVE=$(curl -s "$BASE/products?limit=100" | jq '.data.products | length')
echo "  productos visibles para admin: $TOTAL_ALL (activos: $TOTAL_ACTIVE)"

echo "──────────────────────────────────────────────"
echo "▶ 11. Admin: crear y desactivar producto"
echo "──────────────────────────────────────────────"
NEW_ID=$(curl -s -X POST $BASE/products -H "Authorization: Bearer $ATOKEN" -H "Content-Type: application/json" \
  -d '{"name":"E2E Test Product","description":"Producto temporal creado por test E2E.","price":42,"stock":10}' | jq -r '.data.product._id')
echo "  ✓ creado: ${NEW_ID: -8}"
curl -s -X DELETE $BASE/products/$NEW_ID -H "Authorization: Bearer $ATOKEN" -o /dev/null -w "  ✓ DELETE: HTTP %{http_code}\n"
curl -s "$BASE/products?includeInactive=true&limit=100" -H "Authorization: Bearer $ATOKEN" | \
  jq -r --arg id "$NEW_ID" '  isActive: \(.data.products[] | select(._id == $id) | .isActive)'

echo "──────────────────────────────────────────────"
echo "✅ E2E completado"
echo "──────────────────────────────────────────────"
Guarda esto como scripts/e2e.sh, dale permisos y ejecuta:

bash
mkdir -p scripts
chmod +x scripts/e2e.sh
./scripts/e2e.sh
✅ Checklist de validación backend (adicional a Fase 2):

□ GET /api/products?includeInactive=true sin token → solo activos.
□ GET /api/products?includeInactive=true con token de user → solo activos.
□ GET /api/products?includeInactive=true con token de admin → todos.
□ Crear/editar producto con admin funciona.
□ DELETE marca isActive: false pero el producto sigue en la DB.
□ PUT con { isActive: true } reactiva el producto.
✅ Checklist de validación frontend:

□ /products y /product/:id renderizan con el nuevo estilo.
□ /checkout sin login → redirige a /login; tras login → vuelve a /checkout.
□ En /checkout, si el backend devuelve errores de campo, aparecen bajo cada input (no como alert global).
□ Tras pago exitoso → /orders/:id con banner verde de éxito.
□ /orders lista los pedidos con badge de estado.
□ Clic en un pedido → detalle con productos, dirección y total.
□ /admin/products (como admin) muestra tabla; botón "+ Nuevo producto" abre modal.
□ Crear producto desde el modal → aparece en la tabla sin recargar.
□ Desactivar producto → su estado cambia a "Inactivo" pero sigue visible para admin.
□ Reactivar producto → vuelve a "Activo".
□ Un usuario user no ve el enlace "Admin" en el header y /admin/products lo redirige a /.
Commit final de la fase:

bash
git add server/ client/ scripts/
git commit -m "feat: checkout flow, order history and admin panel

- Design system with CSS tokens and base components
  (Button, Input, Card, Alert, Badge, Modal, EmptyState)
- Unified Layout with role-aware navigation
- CheckoutPage with field-level error mapping
- OrderDetailPage with success banner
- OrderHistoryPage with status badges
- AdminProductsPage with create/edit/deactivate modal
- optionalAuth middleware for admin product listing
- E2E shell script covering full purchase + admin flow"
📊 3.8 Resumen Visual de la Fase 3

Flujo del cliente (checkout)

text
CartPage                CheckoutPage               Backend
   │                        │                         │
   │── "Proceder al pago" ─▶│                         │
   │                        │── POST /orders/checkout │
   │                        │                         │
   │                        │◀── 400 {errors:[...]} ──│ (si validación falla)
   │                        │  mapea a fieldErrors    │
   │                        │  → render bajo cada input
   │                        │                         │
   │                        │◀── 201 {order} ────────│ (si todo OK)
   │                        │ clearCart()             │
   │                        │ navigate(/orders/:id)   │
   │                        ▼                         │
   │                    OrderDetailPage               │
   │                    ├─ banner verde                │
   │                    ├─ tabla de items              │
   │                    └─ dirección envío             │
Navegación por rol (Layout)

text
┌──────────────────┬──────────────────────────────────────┐
│ Anónimo          │ Catálogo · Carrito · Entrar/Registrar │
│ user             │ Catálogo · Mis pedidos · Carrito · Salir │
│ admin            │ Catálogo · Mis pedidos · Admin · Carrito · Salir │
└──────────────────┴──────────────────────────────────────┘
Mapa de endpoints consumidos por el frontend

Página	Endpoints
ProductListPage	GET /products?page&limit
ProductDetailPage	GET /products/:id
CartPage	GET /cart, PATCH/DELETE /cart/items/:id
CheckoutPage	POST /orders/checkout, DELETE /cart
OrderDetailPage	GET /orders/:id
OrderHistoryPage	GET /orders
AdminProductsPage	GET /products?includeInactive, POST/PUT/DELETE /products/:id
