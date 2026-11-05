# Framework-Neutral Examples

Concrete FSD slice implementations showing the same patterns across frameworks. Presented bottom-up (shared → entities → features → widgets → pages) to demonstrate how dependencies build before consumers import them.

## Example: "Add to Cart" Feature

### shared/api — Transport Layer

```typescript
// shared/api/client.ts — framework-agnostic HTTP wrapper
export interface ApiClient {
  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T>;
  post<T>(path: string, body: unknown, opts?: { signal?: AbortSignal }): Promise<T>;
}

export const apiClient: ApiClient = { /* implementation varies by project */ };
```

### entities/product — Domain Object

**Type definition** (`entities/product/model/types.ts`):
```typescript
export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  imageUrl: string;
  stock: number;
}
```

**Data fetching** (`entities/product/api/product-api.ts`):
```typescript
import { apiClient } from "@/shared/api/client";
import type { Product } from "../model/types";

export async function fetchProduct(productId: string, signal?: AbortSignal): Promise<Product> {
  return apiClient.get<Product>(`/products/${productId}`, { signal });
}
```

**Display component** (`entities/product/ui/ProductPrice`):

React:
```tsx
export function ProductPrice({ price, currency }: { price: number; currency: string }) {
  const formatted = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);
  return <span className="product-price">{formatted}</span>;
}
```

Vue:
```vue
<script setup lang="ts">
const props = defineProps<{ price: number; currency: string }>();
const formatted = computed(() =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: props.currency }).format(props.price)
);
</script>
<template><span class="product-price">{{ formatted }}</span></template>
```

Svelte:
```svelte
<script lang="ts">
  export let price: number;
  export let currency: string;
  $: formatted = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);
</script>
<span class="product-price">{formatted}</span>
```

**Public API** (`entities/product/index.ts`):
```typescript
export { ProductPrice } from "./ui/ProductPrice";
export { fetchProduct } from "./api/product-api";
export type { Product } from "./model/types";
```

### features/add-to-cart — User Action

**Types** (`features/add-to-cart/model/types.ts`):
```typescript
export interface CartItem {
  productId: string;
  quantity: number;
}
export interface AddToCartResult {
  success: boolean;
  cartTotal: number;
}
```

**API** (`features/add-to-cart/api/cart-api.ts`):
```typescript
import { apiClient } from "@/shared/api/client";
import type { AddToCartResult, CartItem } from "../model/types";

export async function addItemToCart(item: CartItem, signal?: AbortSignal): Promise<AddToCartResult> {
  return apiClient.post<AddToCartResult>("/cart/items", item, { signal });
}
```

**Interaction logic** (`features/add-to-cart/model/use-add-to-cart`):

React (hook):
```tsx
import { useCallback, useState } from "react";
import { addItemToCart } from "../api/cart-api";
import type { AddToCartResult } from "./types";

export function useAddToCart() {
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addToCart = useCallback(async (productId: string, quantity: number) => {
    setIsAdding(true);
    setError(null);
    try {
      await addItemToCart({ productId, quantity });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to cart");
    } finally {
      setIsAdding(false);
    }
  }, []);

  return { addToCart, isAdding, error };
}
```

Vue (composable):
```typescript
import { ref } from "vue";
import { addItemToCart } from "../api/cart-api";

export function useAddToCart() {
  const isAdding = ref(false);
  const error = ref<string | null>(null);

  async function addToCart(productId: string, quantity: number) {
    isAdding.value = true;
    error.value = null;
    try {
      await addItemToCart({ productId, quantity });
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to add to cart";
    } finally {
      isAdding.value = false;
    }
  }

  return { addToCart, isAdding, error };
}
```

Svelte (store):
```typescript
import { writable } from "svelte/store";
import { addItemToCart } from "../api/cart-api";

export function createAddToCartStore() {
  const isAdding = writable(false);
  const error = writable<string | null>(null);

  async function addToCart(productId: string, quantity: number) {
    isAdding.set(true);
    error.set(null);
    try {
      await addItemToCart({ productId, quantity });
    } catch (err) {
      error.set(err instanceof Error ? err.message : "Failed to add to cart");
    } finally {
      isAdding.set(false);
    }
  }

  return { addToCart, isAdding, error };
}
```

**UI** (`features/add-to-cart/ui/AddToCartButton`):

React:
```tsx
import { useAddToCart } from "../model/use-add-to-cart";

export function AddToCartButton({ productId, stock }: { productId: string; stock: number }) {
  const { addToCart, isAdding, error } = useAddToCart();
  return (
    <div>
      <button onClick={() => addToCart(productId, 1)} disabled={isAdding || stock === 0}>
        {isAdding ? "Adding..." : stock === 0 ? "Out of Stock" : "Add to Cart"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
```

Vue:
```vue
<script setup lang="ts">
import { useAddToCart } from "../model/use-add-to-cart";
const props = defineProps<{ productId: string; stock: number }>();
const { addToCart, isAdding, error } = useAddToCart();
</script>
<template>
  <div>
    <button @click="addToCart(props.productId, 1)" :disabled="isAdding || props.stock === 0">
      {{ isAdding ? "Adding..." : props.stock === 0 ? "Out of Stock" : "Add to Cart" }}
    </button>
    <p v-if="error" class="error-text">{{ error }}</p>
  </div>
</template>
```

**Public API** (`features/add-to-cart/index.ts`):
```typescript
export { AddToCartButton } from "./ui/AddToCartButton";
export type { CartItem, AddToCartResult } from "./model/types";
```

### widgets/product-card — Composition

The widget combines entity display with feature action. It knows about both but adds no new business logic.

React:
```tsx
import { ProductPrice, type Product } from "@/entities/product";
import { AddToCartButton } from "@/features/add-to-cart";

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product-card">
      <img src={product.imageUrl} alt={product.name} />
      <h3>{product.name}</h3>
      <ProductPrice price={product.price} currency={product.currency} />
      <AddToCartButton productId={product.id} stock={product.stock} />
    </article>
  );
}
```

Vue:
```vue
<script setup lang="ts">
import { ProductPrice, type Product } from "@/entities/product";
import { AddToCartButton } from "@/features/add-to-cart";
defineProps<{ product: Product }>();
</script>
<template>
  <article class="product-card">
    <img :src="product.imageUrl" :alt="product.name" />
    <h3>{{ product.name }}</h3>
    <ProductPrice :price="product.price" :currency="product.currency" />
    <AddToCartButton :productId="product.id" :stock="product.stock" />
  </article>
</template>
```

### pages/product-detail — Route Composition

The page fetches data and composes widgets. This is where orchestration lives.

React:
```tsx
import { fetchProduct } from "@/entities/product";
import { ProductCard } from "@/widgets/product-card";

export function ProductDetailPage({ productId }: { productId: string }) {
  // Data fetching approach varies by project convention
  const product = useSuspenseQuery(["product", productId], () => fetchProduct(productId));

  return (
    <main className="product-detail">
      <ProductCard product={product} />
    </main>
  );
}
```

Vue:
```vue
<script setup lang="ts">
import { fetchProduct } from "@/entities/product";
import { ProductCard } from "@/widgets/product-card";

const props = defineProps<{ productId: string }>();
const { data: product } = await useAsyncData(() => fetchProduct(props.productId));
</script>
<template>
  <main class="product-detail">
    <ProductCard v-if="product" :product="product" />
  </main>
</template>
```

## Import Direction Verification

```text
pages/product-detail  →  widgets/product-card   ✓ (down)
widgets/product-card  →  features/add-to-cart    ✓ (down)
widgets/product-card  →  entities/product        ✓ (down)
features/add-to-cart  →  shared/api/client       ✓ (down)
entities/product      →  shared/api/client       ✓ (down)
```

No sideways or upward imports. Every cross-slice import goes through `index.ts`.

## Key Observations

- The **pattern is identical** regardless of framework — layers, slices, segments, and import direction don't change
- Only the **reactivity primitives** differ: hooks (React), composables (Vue), stores (Svelte), services (Angular)
- The **public API** (`index.ts`) is always the same: explicit named exports
- **Data fetching** approach varies by project convention but always lives in entity/feature `api/` segments
