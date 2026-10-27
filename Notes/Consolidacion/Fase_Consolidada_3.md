
___________________________________________________________
👑 FASE 3 — Checkout UI, Admin con 2FA y Audit Log

📖 1. La Historia (El Porqué)

El backend ya puede autenticar y gestionar operaciones locales. Ahora conectamos las pantallas reales con esos contratos. La UI no debe inventar reglas distintas de las que aplica la API.

Puntos críticos a entender en esta fase:

Checkout con Idempotencia en UI: La pantalla de checkout debe generar un Idempotency-Key al montarse. Si el usuario hace doble clic en "Pagar", el backend devolverá la misma orden. Debemos persistir el borrador en sessionStorage para que no se pierda si el usuario refresca la página.
Administración y 2FA: Un rol admin no basta. Exigimos un segundo factor (TOTP / Google Authenticator) con 10 códigos de respaldo (backup codes) de un solo uso. El servidor nunca devuelve el secreto 2FA en las respuestas.
Bypass de 2FA en Tests: Para las pruebas automatizadas, si NODE_ENV=test y DISABLE_2FA_IN_TEST=true, el servicio de 2FA deja pasar al usuario sin pedir el código TOTP.
Audit Log: Cualquier acción crítica (crear/editar producto, cambiar estado de pedido) se registra en AuditLog. El registro no debe bloquear la operación principal si falla.
Sistema de Diseño: Necesitamos unificar la UI con tokens CSS, componentes reutilizables (Button, FormField, Modal) y un Layout con Header/NavLink.
___________________________________________________________
📋 2. El Checklist (El Qué)

□ Frontend (Diseño): Crear theme.css, components.css, y los componentes Button.tsx, FormField.tsx, Alert.tsx, Badge.tsx, EmptyState.tsx, Modal.tsx.
□ Frontend (Layout): Crear Layout.tsx con Header, NavLinks, contador de carrito, menú condicional y Footer.
□ Frontend (Cliente): Crear CheckoutPage.tsx (con Idempotency-Key y mapeo de errores), OrderDetailPage.tsx, OrderHistoryPage.tsx.
□ Backend (Admin/Audit): Añadir optionalAuth al middleware. Crear modelo AuditLog y servicio audit.service.ts.
□ Backend (Admin/2FA): Ampliar User con campos 2FA. Crear twoFactor.service.ts.
□ Backend (Auth): Refactorizar login para retornar requires2FA. Crear ruta /2fa/verify.
□ Frontend (Admin): Crear AdminProductsPage.tsx, ProductForm.tsx, AdminSecurityPage.tsx. Actualizar LoginPage.tsx para manejar 2FA.
□ Testing: Crear scripts/e2e.sh (flujo completo: registro → login → compra → admin → 2FA).
___________________________________________________________
💻 3. La Implementación (El Cómo)

Paso 3.1: Backend — Auditoría y 2FA

server/src/models/AuditLog.ts
___________________________________________________________
import mongoose, { Schema } from 'mongoose';

const auditSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  resource: { type: String, required: true },
  resourceId: { type: String },
  metadata: { type: Schema.Types.Mixed },
  ip: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
});

auditSchema.index({ userId: 1, timestamp: -1 });

export const AuditLogModel = mongoose.model('AuditLog', auditSchema);
___________________________________________________________
server/src/services/audit.service.ts
___________________________________________________________
import { AuditLogModel } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

export function logAdminAction(entry: {
  userId: string; action: string; resource: string; 
  resourceId?: string; metadata?: any; ip?: string;
}) {
  // No bloqueante: si falla el log, la app sigue funcionando
  AuditLogModel.create(entry).catch((err) => logger.error({ err }, 'Audit log failed'));
}
___________________________________________________________
Actualizar server/src/models/User.ts (Añadir campos 2FA)
___________________________________________________________
// Añadir en la interfaz UserDoc:
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];

// Añadir en el userSchema:
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  twoFactorBackupCodes: { type: [String], select: false },

// Asegurar en el toJSON transform:
  delete (ret as any).twoFactorSecret;
  delete (ret as any).twoFactorBackupCodes;
___________________________________________________________
server/src/services/twoFactor.service.ts
___________________________________________________________
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { UserModel } from '../models/User.js';

export async function generateSetup(userId: string) {
  const secret = speakeasy.generateSecret({ name: `e_commerce_01 (${userId})`, issuer: 'e_commerce_01' });
  const qr = await QRCode.toDataURL(secret.otpauth_url!);
  await UserModel.findByIdAndUpdate(userId, {
    twoFactorSecret: secret.base32,
    twoFactorEnabled: false,
  });
  return { qr, secret: secret.base32 };
}

export async function confirmSetup(userId: string, code: string) {
  const user = await UserModel.findById(userId).select('+twoFactorSecret');
  if (!user?.twoFactorSecret) throw new Error('Sin setup pendiente');

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret, encoding: 'base32', token: code, window: 1,
  });
  if (!valid) throw new Error('Código inválido');

  // 10 backup codes, hasheados
  const codes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')
  );
  const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

  user.twoFactorEnabled = true;
  user.twoFactorBackupCodes = hashed;
  await user.save();

  return { backupCodes: codes }; // Mostrar al usuario UNA sola vez
}

export async function verifyTwoFactor(user: any, code: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'test' && process.env.DISABLE_2FA_IN_TEST === 'true') return true;
  if (!user.twoFactorEnabled) return true;

  const u = await UserModel.findById(user.id).select('+twoFactorSecret +twoFactorBackupCodes');
  if (!u?.twoFactorSecret) return false;

  const validTotp = speakeasy.totp.verify({
    secret: u.twoFactorSecret, encoding: 'base32', token: code, window: 1,
  });
  if (validTotp) return true;

  // Probar backup codes (un solo uso)
  for (let i = 0; i < u.twoFactorBackupCodes.length; i++) {
    if (await bcrypt.compare(code, u.twoFactorBackupCodes[i])) {
      u.twoFactorBackupCodes.splice(i, 1);
      await u.save();
      return true;
    }
  }
  return false;
}
___________________________________________________________
Paso 3.2: Backend — Refactor de Auth y Middlewares

Actualizar server/src/middlewares/auth.middleware.ts (Añadir optionalAuth)
___________________________________________________________
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const payload = verifyAccessToken(header.slice(7));
    const user = await UserModel.findById(payload.sub);
    if (user) (req as any).user = user;
  } catch { /* ignore */ }
  next();
}
___________________________________________________________
Actualizar server/src/services/auth.service.ts (Manejo de 2FA en Login)
___________________________________________________________
import { verifyTwoFactor } from './twoFactor.service.js';

export async function loginUser(email: string, password: string) {
  const user = await UserModel.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError(401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

  if (user.twoFactorEnabled) {
    const tempToken = signAccessToken({ sub: user.id, role: 'temp2fa' });
    return { requires2FA: true as const, tempToken };
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });
  user.refreshTokenHash = hashToken(refreshToken);
  user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 864e5);
  await user.save();
  return { user: user.toJSON(), accessToken, refreshToken };
}
___________________________________________________________
Actualizar server/src/controllers/auth.controller.ts
___________________________________________________________
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result: any = await authService.loginUser(req.body.email, req.body.password);
    if (result.requires2FA) return res.json({ requires2FA: true, tempToken: result.tempToken });
    
    res.cookie('refreshToken', result.refreshToken, cookieOpts);
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (e) { next(e); }
}

export async function verify2FA(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = req.body;
    const { verifyAccessToken, signAccessToken, signRefreshToken, hashToken } = await import('../utils/jwt.js');
    const payload = verifyAccessToken(tempToken);
    
    if (payload.role !== 'temp2fa') return res.status(401).json({ code: 'INVALID_TEMP', message: 'Token inválido' });
    
    const user = await UserModel.findById(payload.sub);
    if (!user) return res.status(401).json({ code: 'USER_NOT_FOUND', message: 'No encontrado' });
    
    const ok = await twoFactorService.verifyTwoFactor(user, code);
    if (!ok) return res.status(401).json({ code: 'INVALID_2FA', message: 'Código 2FA inválido' });
    
    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id });
    user.refreshTokenHash = hashToken(refreshToken);
    await user.save();
    
    res.cookie('refreshToken', refreshToken, cookieOpts);
    res.json({ user: user.toJSON(), accessToken });
  } catch (e) { next(e); }
}
___________________________________________________________
(Recuerda importar twoFactorService y UserModel en el controlador).

Actualizar server/src/routes/auth.routes.ts (Añadir rutas 2FA y verificación)
___________________________________________________________
import { protect, admin } from '../middlewares/auth.middleware.js';
import { generateSetup, confirmSetup } from '../services/twoFactor.service.js';

// Ruta para verificar el código TOTP después del login
authRouter.post('/2fa/verify', authLimiter, ctrl.verify2FA);

// Rutas para configurar el 2FA (solo admin)
authRouter.post('/2fa/setup', protect, admin, async (req: any, res, next) => {
  try { res.json(await generateSetup(req.user.id)); } catch (e) { next(e); }
});

authRouter.post('/2fa/confirm', protect, admin, async (req: any, res, next) => {
  try { res.json(await confirmSetup(req.user.id, req.body.code)); } catch (e) { next(e); }
});
___________________________________________________________
Instrumentar AuditLog en server/src/controllers/product.controller.ts
___________________________________________________________
import { logAdminAction } from '../services/audit.service.js';

export async function create(req: any, res: Response, next: NextFunction) {
  try {
    const product = await productService.createProduct(req.body);
    logAdminAction({ 
      userId: req.user.id, action: 'CREATE_PRODUCT', resource: 'Product', 
      resourceId: product.id, ip: req.ip 
    });
    res.status(201).json(product);
  } catch (e) { next(e); }
}
// Hacer lo mismo para update y delete
___________________________________________________________
Paso 3.3: Frontend — Sistema de Diseño y Layout

client/src/styles/theme.css
___________________________________________________________
:root {
  --color-primary: #2563eb;
  --color-bg: #f9fafb;
  --color-text: #111827;
  --color-error: #dc2626;
  --spacing: 4px;
}
body { margin: 0; font-family: system-ui, sans-serif; background: var(--color-bg); color: var(--color-text); }
___________________________________________________________
client/src/components/FormField.tsx
___________________________________________________________
export function FormField({ label, error, ...props }: any) {
  return (
    <div className="field" style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontWeight: 'bold' }}>{label}</label>
      <input 
        {...props} 
        style={{ width: '100%', padding: '0.5rem', border: error ? '1px solid var(--color-error)' : '1px solid #ccc' }} 
        aria-invalid={!!error}
        aria-describedby={error ? `${props.name}-error` : undefined} 
      />
      {error && <span id={`${props.name}-error`} role="alert" style={{ color: 'var(--color-error)', fontSize: '0.8rem' }}>{error}</span>}
    </div>
  );
}
___________________________________________________________
client/src/components/Modal.tsx
___________________________________________________________
import { useEffect } from 'react';

export function Modal({ isOpen, onClose, title, children }: any) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'white', padding: '2rem', borderRadius: '8px' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
        <button onClick={onClose} style={{ marginTop: '1rem' }}>Cerrar</button>
      </div>
    </div>
  );
}
___________________________________________________________
client/src/components/Layout.tsx
___________________________________________________________
import { Outlet, NavLink, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../context/CartContext';

export function Layout() {
  const { user } = useAuth();
  const { count } = useCart();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '1rem', background: 'white', borderBottom: '1px solid #eee', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <NavLink to="/" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>e_commerce_01</NavLink>
        <NavLink to="/products">Productos</NavLink>
        <NavLink to="/cart">Carrito ({count})</NavLink>
        {user?.role === 'admin' && <NavLink to="/admin/products">Admin</NavLink>}
        <div style={{ marginLeft: 'auto' }}>
          {user ? <span>{user.name}</span> : <Link to="/login">Login</Link>}
        </div>
      </header>
      <main style={{ flex: 1, padding: '2rem' }}>
        <Outlet />
      </main>
      <footer style={{ padding: '1rem', textAlign: 'center', background: 'white', borderTop: '1px solid #eee' }}>
        &copy; 2024 e_commerce_01
      </footer>
    </div>
  );
}
___________________________________________________________
Paso 3.4: Frontend — Checkout, Órdenes y Login 2FA

client/src/pages/CheckoutPage.tsx
___________________________________________________________
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { useCart } from '../context/CartContext';
import { formatCurrency } from '../utils/formatCurrency';

export function CheckoutPage() {
  const navigate = useNavigate();
  const { total } = useCart();
  const [idempotencyKey] = useState(() => crypto.randomUUID()); // Se genera UNA vez
  const [form, setForm] = useState({ name: '', street: '', city: '', country: 'CO', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/orders/checkout', {
        shippingAddress: form
      }, {
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      navigate(`/orders/${res.data.order.id}`, { state: { justCreated: true } });
    } catch (err: any) {
      if (err.response?.data?.errors) {
        const fieldErrors: Record<string, string> = {};
        err.response.data.errors.forEach((e: any) => {
          // Mapear "shippingAddress.street" a "street"
          const field = e.field.replace(/^shippingAddress\./, '');
          fieldErrors[field] = e.message;
        });
        setErrors(fieldErrors);
      }
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <h1>Finalizar Compra</h1>
      <form onSubmit={handleSubmit}>
        <FormField label="Nombre" name="name" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <FormField label="Calle" name="street" value={form.street} onChange={(e: any) => setForm({ ...form, street: e.target.value })} error={errors.street} />
        <FormField label="Ciudad" name="city" value={form.city} onChange={(e: any) => setForm({ ...form, city: e.target.value })} error={errors.city} />
        <FormField label="Teléfono" name="phone" value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} error={errors.phone} />
        
        <h3>Total a pagar: {formatCurrency(total)}</h3>
        <button type="submit" style={{ width: '100%', padding: '1rem', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '4px' }}>
          Pagar (Demo)
        </button>
      </form>
    </div>
  );
}
___________________________________________________________
client/src/pages/OrderHistoryPage.tsx
___________________________________________________________
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Link } from 'react-router-dom';

export function OrderHistoryPage() {
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    api.get('/orders').then(res => setOrders(res.data));
  }, []);

  return (
    <div>
      <h1>Mis Pedidos</h1>
      {orders.length === 0 ? <p>No tienes pedidos.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {orders.map(o => (
            <li key={o.id} style={{ background: 'white', padding: '1rem', marginBottom: '1rem', borderRadius: '4px' }}>
              <Link to={`/orders/${o.id}`}>Pedido #{o.id.slice(-6)}</Link> - {new Date(o.createdAt).toLocaleDateString()} - {o.status} - {o.paymentStatus}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
___________________________________________________________
Actualizar client/src/pages/LoginPage.tsx (Manejo de 2FA)
___________________________________________________________
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { api, setAccessToken } from '../services/api';
import { FormField } from '../components/FormField';

export function LoginPage() {
  const { login, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [code, setCode] = useState('');
  const [tempToken, setTempToken] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requires2FA) {
      try {
        const res = await api.post('/auth/login', { email, password });
        if (res.data.requires2FA) {
          setRequires2FA(true);
          setTempToken(res.data.tempToken);
        }
      } catch (err: any) {
        // Manejar error de credenciales
      }
    } else {
      try {
        const res = await api.post('/auth/2fa/verify', { tempToken, code });
        setAccessToken(res.data.accessToken);
        navigate('/admin'); // Redirigir al panel de admin
      } catch (err: any) {
        alert('Código 2FA incorrecto');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: '400px', margin: '2rem auto' }}>
      <h1>Iniciar Sesión</h1>
      {!requires2FA ? (
        <>
          <FormField label="Email" name="email" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} required />
          <FormField label="Contraseña" name="password" type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} required />
        </>
      ) : (
        <FormField label="Código 2FA (Google Authenticator)" name="code" value={code} onChange={(e: any) => setCode(e.target.value)} required />
      )}
      <button type="submit" style={{ width: '100%', padding: '0.8rem', background: 'var(--color-primary)', color: 'white', border: 'none' }}>
        {requires2FA ? 'Verificar Código' : 'Entrar'}
      </button>
    </form>
  );
}
___________________________________________________________
Paso 3.5: Frontend — Páginas de Administración

client/src/pages/admin/AdminSecurityPage.tsx
___________________________________________________________
import { useState } from 'react';
import { api } from '../../services/api';

export function AdminSecurityPage() {
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const handleSetup = async () => {
    const res = await api.post('/auth/2fa/setup');
    setQr(res.data.qr);
  };

  const handleConfirm = async () => {
    const res = await api.post('/auth/2fa/confirm', { code });
    setBackupCodes(res.data.backupCodes);
  };

  return (
    <div>
      <h1>Seguridad (2FA)</h1>
      {!qr && <button onClick={handleSetup}>Activar 2FA</button>}
      {qr && !backupCodes.length && (
        <div>
          <p>Escanea este código con Google Authenticator:</p>
          <img src={qr} alt="QR Code" />
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Ingresa el código" />
          <button onClick={handleConfirm}>Confirmar</button>
        </div>
      )}
      {backupCodes.length > 0 && (
        <div style={{ background: '#fef08a', padding: '1rem' }}>
          <h3>Guarda estos códigos de respaldo (no se mostrarán de nuevo):</h3>
          <ul>{backupCodes.map(c => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
___________________________________________________________
client/src/pages/admin/AdminProductsPage.tsx
___________________________________________________________
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Modal } from '../../components/Modal';
import { ProductForm } from './ProductForm';

export function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadProducts = () => api.get('/products').then(res => setProducts(res.data));
  useEffect(() => { loadProducts(); }, []);

  return (
    <div>
      <h1>Administrar Productos</h1>
      <button onClick={() => setIsModalOpen(true)}>Crear Producto</button>
      <table style={{ width: '100%', marginTop: '1rem', background: 'white' }}>
        <thead><tr><th>Nombre</th><th>Precio</th><th>Stock</th></tr></thead>
        <tbody>
          {products.map(p => (
            <tr key={p.id}><td>{p.name}</td><td>{p.price / 100}</td><td>{p.stock}</td></tr>
          ))}
        </tbody>
      </table>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nuevo Producto">
        <ProductForm onSuccess={() => { setIsModalOpen(false); loadProducts(); }} />
      </Modal>
    </div>
  );
}
___________________________________________________________
Paso 3.6: Script E2E Completo

scripts/e2e.sh
___________________________________________________________
#!/bin/bash
set -e

API="http://localhost:3000/api"
TOKEN=""
ADMIN_TOKEN=""

echo "1. Registro de usuario..."
curl -s -X POST $API/auth/register -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.com","name":"E2E","password":"Password1"}' > /dev/null

echo "2. Login de usuario..."
TOKEN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"e2e@test.com","password":"Password1"}' | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

echo "3. Crear producto (Admin)..."
ADMIN_EMAIL="admin@e_commerce_01.com"
ADMIN_PASS="AdminPassword1"
# Asumiendo que el admin ya fue creado con npm run create-admin
ADMIN_TOKEN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

PRODUCT_ID=$(curl -s -X POST $API/products -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Test Product","price":1000,"stock":5}' | grep -o '"id":"[^"]*' | cut -d'"' -f4)

echo "4. Añadir al carrito..."
curl -s -X POST $API/cart -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}" > /dev/null

echo "5. Checkout..."
IDEMPOTENCY_KEY=$(uuidgen)
curl -s -X POST $API/orders/checkout -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"shippingAddress":{"name":"E2E","street":"Calle 1","city":"Bogota","country":"CO","phone":"123"}}' > /dev/null

echo "E2E Completado con éxito"
___________________________________________________________
🚦 4. Gate 3 (Validación)

No avances a la Fase 4 hasta que se cumplan TODOS estos puntos:

□ Errores de campo: En CheckoutPage, si el backend devuelve un error de validación, el mensaje debe aparecer justo debajo del campo correspondiente (no como un alert global).
□ 2FA Setup: Navegar a /admin/security. Hacer clic en "Activar 2FA". Escanear el QR con Google Authenticator. Ingresar el código. Deben aparecer los 10 backup codes.
□ Login con 2FA: Cerrar sesión. Iniciar sesión como admin. La UI debe pedir el código TOTP (no debe emitir el token final hasta que se ingrese).
□ Bypass 2FA: En NODE_ENV=test con DISABLE_2FA_IN_TEST=true, el login de admin debe devolver el token directamente sin pedir TOTP.
□ Audit Log: Crear un producto desde el panel de Admin. Verificar en MongoDB (db.auditlogs.find()) que se ha registrado el evento.
□ Script E2E: Ejecutar ./scripts/e2e.sh. Debe completarse sin errores y el pedido debe aparecer en la base de datos.
□ Header Dinámico: El usuario normal no ve el enlace a "Admin". El admin sí lo ve.
□ Carrito Persistente: El contador del carrito en el Layout se actualiza al añadir productos.