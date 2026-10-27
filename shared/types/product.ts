export interface Product {
    id: string;
    name: string;
    slug: string;
    description: string;
    price: number; //unidades menores (centavos)
    currency: string  // 1SO 4217
    stock: number;
    imageUrl: string;
    category: string;
    isActive: boolean;
}