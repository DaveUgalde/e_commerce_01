import type { Product } from "./product";
export interface CartItem {
    product: Product;
    quantity: number;
}

export interface Cart {
    id: string;
    userId: string;
    items: CartItem[];
    total: number;
}