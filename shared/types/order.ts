export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface OrderItem {
    productId: string;
    name: string;
    priceAtPurchase: number;
    quantity: number;
}

export interface Order {
    id: string;
    userId: string;
    items: number;
    total: number;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    createdAt: string;
}