<!-- Source: Addy Osmani / agent-skills / performance-optimization -->

# Web Performance Targets and Patterns

## Core Web Vitals Targets

| Metric | Good | Needs Improvement | Poor | What It Measures |
|--------|------|-------------------|------|-----------------|
| **LCP** (Largest Contentful Paint) | < 2.5s | 2.5s – 4.0s | > 4.0s | Time until largest visible content renders |
| **INP** (Interaction to Next Paint) | < 200ms | 200ms – 500ms | > 500ms | Responsiveness to user interactions |
| **CLS** (Cumulative Layout Shift) | < 0.1 | 0.1 – 0.25 | > 0.25 | Visual stability — unexpected layout movement |

Targets apply at the **75th percentile** of page loads. A page "passes" a metric when 75% of real users experience the "Good" threshold.

---

## Where to Start Measuring — Decision Tree

```
What symptom are you seeing?
├── First page load is slow
│   → Tool: Lighthouse (lab) + PageSpeed Insights (field/CrUX)
│   → Metrics: LCP, FCP, TBT, Speed Index
├── Interactions feel sluggish (click, type, toggle)
│   → Tool: Chrome DevTools Performance panel → Interactions tab
│   → Metrics: INP, Long Tasks (>50ms), blocking time
├── Page after navigation (SPA route transition) is slow
│   → Tool: web-vitals library (instrument in code) + DevTools
│   → Metrics: soft-nav LCP, INP on route change
└── Backend API responses are slow
    → Tool: Server Timing headers + distributed traces (OpenTelemetry)
    → Metrics: TTFB contribution, p95/p99 latency by endpoint
```

**Synthetic vs RUM:**
- **Synthetic** (Lighthouse, WebPageTest, DevTools): controlled lab conditions, reproducible, catches regressions before deploy. Use for CI performance gates.
- **RUM** (Real User Monitoring: web-vitals library, CrUX, SpeedCurve): real devices, real networks, real variance. Use to validate that lab improvements translate to production. CrUX data is 28-day rolling — changes take time to appear.

---

## Image Optimization Patterns

### Full `<picture>` Element with Art Direction

```html
<picture>
  <!-- Art direction: different crop on small screens (single URL per source, no w descriptor needed) -->
  <source
    media="(max-width: 768px)"
    srcset="hero-mobile.avif"
    type="image/avif"
  />
  <source
    media="(max-width: 768px)"
    srcset="hero-mobile.webp"
    type="image/webp"
  />
  <!-- Resolution switching: multiple sizes for larger screens -->
  <source
    srcset="hero-800.avif 800w, hero-1200.avif 1200w, hero-1600.avif 1600w"
    sizes="(max-width: 1024px) 100vw, 1200px"
    type="image/avif"
  />
  <source
    srcset="hero-800.webp 800w, hero-1200.webp 1200w, hero-1600.webp 1600w"
    sizes="(max-width: 1024px) 100vw, 1200px"
    type="image/webp"
  />
  <!-- JPEG fallback for browsers without AVIF/WebP support -->
  <img
    src="hero-1200.jpg"
    srcset="hero-800.jpg 800w, hero-1200.jpg 1200w, hero-1600.jpg 1600w"
    sizes="(max-width: 1024px) 100vw, 1200px"
    alt="Hero image description"
    width="1200"
    height="630"
    fetchpriority="high"
  />
</picture>

<!-- Below-fold images: lazy load and async decode -->
<img
  src="card-image.webp"
  alt="Card image description"
  width="400"
  height="300"
  loading="lazy"
  decoding="async"
/>
```

**Rules:**
- `fetchpriority="high"` on the LCP image — tells the browser to preload it aggressively
- `loading="lazy"` only on images below the fold — applying it to LCP images hurts LCP
- Always include `width` and `height` attributes — prevents CLS from layout shift while image loads
- AVIF is ~50% smaller than JPEG at equivalent quality; WebP is ~30% smaller

---

## React Optimization Patterns

### `React.memo` and Stable References

```tsx
// BAD — new object on every render causes all consumers to re-render
function Parent() {
  return <Chart options={{ animate: true }} />;
}

// GOOD — stable reference, memo works correctly
const DEFAULT_OPTIONS = { animate: true } as const;

const Chart = React.memo(function Chart({ options }: { options: typeof DEFAULT_OPTIONS }) {
  return <canvas />;
});

function Parent() {
  return <Chart options={DEFAULT_OPTIONS} />;
}
```

### `useMemo` for Expensive Computations

```tsx
function DataGrid({ rows, filters }: Props) {
  // Only recompute when rows or filters change
  const filteredRows = useMemo(
    () => rows.filter(row => matchesFilters(row, filters)),
    [rows, filters]
  );

  return <VirtualizedList items={filteredRows} />;
}
```

**Caution:** Overusing `memo` and `useMemo` is as bad as underusing them. Every memoization adds overhead (comparison cost, memory). Profile before memoizing. Memoize when:
- A component re-renders frequently with the same props
- A computation is measurably expensive (>1ms)
- A stable reference is needed to prevent child re-renders

---

## Bundle Size Patterns

### Tree-Shaking Requirements

Tree-shaking only works when:
1. The package uses **ES modules** (not CommonJS `require`)
2. The package sets `"sideEffects": false` (or an explicit list) in `package.json`
3. The bundler is configured for production (Webpack/Vite/Rollup with tree-shaking enabled)

Check before adding a dependency:
```bash
# Analyze what a package actually exports and whether it's tree-shakeable
npx bundle-phobia <package-name>
```

### Route-Level Code Splitting

```tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </Suspense>
  );
}
```

Each route becomes a separate chunk. Users only download code for pages they visit.

---

## Performance Budget

| Resource | Budget | Rationale |
|----------|--------|-----------|
| JavaScript (gzipped) | < 200KB | Beyond this, parse/compile time dominates on mid-range mobile |
| CSS (gzipped) | < 50KB | Large CSS slows render-blocking stylesheet parse |
| Total Blocking Time (lab) | < 200ms | Lab proxy for main-thread responsiveness; measured by Lighthouse |
| INP (field/RUM) | < 200ms at p75 | Current Core Web Vitals responsiveness target (replaces FID) |
| Lighthouse Performance score | ≥ 90 | Composite score; correlates with CWV thresholds |
| LCP image | < 200KB (AVIF) | Largest contentful image; compress before shipping |

### CI Enforcement

```yaml
# bundlesize in CI (package.json)
"bundlesize": [
  { "path": "./dist/assets/*.js", "maxSize": "200 kB" },
  { "path": "./dist/assets/*.css", "maxSize": "50 kB" }
]
```

```javascript
// Lighthouse CI (lighthouserc.js)
module.exports = {
  ci: {
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
  },
};
```

---

## HTTP Caching

For assets with content-hashed filenames (most build tools produce these):

```
Cache-Control: public, max-age=31536000, immutable
```

- `immutable` tells the browser the file will never change — no conditional revalidation needed
- Only safe when the filename includes a content hash (e.g., `main.a3f2c1.js`)
- HTML files must never be immutably cached — they reference the hashed assets

---

## N+1 Query Fix (Prisma)

```typescript
// BAD — N+1: one query for orders, then one per order for user
const orders = await prisma.order.findMany();
for (const order of orders) {
  order.user = await prisma.user.findUnique({ where: { id: order.userId } });
}

// GOOD — two queries total, joined in application memory
const orders = await prisma.order.findMany({
  include: {
    user: true,
    items: {
      include: { product: true },
    },
  },
});
```

For very large result sets, prefer `select` over `include` to limit field payload.
