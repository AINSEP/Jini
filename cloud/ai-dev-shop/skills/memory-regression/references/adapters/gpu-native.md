# Memory Regression — GPU / Native Adapter (Field Guide)

> Snippets below are **pattern fragments**, not complete test files.
> Adapt to the target project's graphics API, build system, and test harness.

## When to Use

GPU-intensive applications, game engines, media processing, native (C/C++/Rust) libraries, and any software using direct GPU allocation or manual memory management.

## Primary Signals

### GPU Resources

| Metric | API/Tool | What It Catches |
|---|---|---|
| GPU memory usage | `nvidia-smi`, `VK_EXT_memory_budget`, `MTLDevice.currentAllocatedSize` | Texture/buffer retention |
| Resource object count | Application resource registry | Object-level leak tracking |
| GPU memory available | `GL_GPU_MEMORY_INFO_*` (NVIDIA ext) | Driver-level memory pressure |

### Native Memory

| Metric | API/Tool | What It Catches |
|---|---|---|
| Leak count | AddressSanitizer / LeakSanitizer / Valgrind | Unfreed allocations |
| RSS/VSZ | `/proc/<pid>/smaps_rollup`, `vmmap` | Process memory growth |
| Allocation count | Custom tracking (alloc/free counters) | Balance verification |
| FD count | `/proc/<pid>/fd` count, `lsof` | Handle leaks |

## Prerequisites

- **No garbage collection.** Every allocation requires explicit deallocation
- Every `create`/`alloc`/`new`/`open` must have a corresponding `destroy`/`free`/`delete`/`close`
- RAII / smart pointers / ownership types are the primary prevention mechanism
- Measurement is deterministic: if it's leaked, it stays leaked

## Platform Gotchas

1. **There is no GC to force.** If a resource is leaked, it remains leaked until process exit. This makes measurement deterministic but means cleanup must be explicit and complete.

2. **GPU resource leaks are invisible to heap tools.** Valgrind/ASan track CPU-side `malloc`/`free` but not GPU allocations. GPU leaks require either driver queries or application-level resource tracking.

3. **Vulkan/Metal/DX12 require explicit memory management.** Every `vkAllocateMemory` needs `vkFreeMemory`. Every `MTLBuffer` needs release. Every `CreateCommittedResource` needs `Release`. Missing even one = permanent leak.

4. **OpenGL has no built-in "count my objects" API.** You must maintain an application-level resource registry to track creates vs deletes. The NVIDIA extension `GL_GPU_MEMORY_INFO_*` provides memory totals but not object counts.

5. **`realloc` can leak.** `ptr = realloc(ptr, newsize)` — if realloc fails, it returns NULL and the original pointer is lost. Always assign to a temp variable first.

6. **Rust's ownership prevents most leaks in safe code.** Leaks occur at: `unsafe` boundaries, `std::mem::forget`, `Rc`/`Arc` cycles, FFI (`Box::into_raw` without `from_raw`), and leaked spawned tasks.

7. **ASan/LSan only report at process exit.** They don't catch leaks mid-test-run. For iterative regression testing, use application-level allocation counting.

## Key API Surface

### Compile-Time Leak Detection (C/C++)

```bash
# Pattern fragment: build with sanitizers
clang++ -fsanitize=address,leak -fno-omit-frame-pointer -g -o myapp myapp.cpp
# LSan reports all leaks at exit with full stack traces
```

```bash
# Pattern fragment: Valgrind for detailed analysis
valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes ./myapp
# Reports: definitely lost, indirectly lost, possibly lost, still reachable
```

### Application-Level Resource Tracking

```c
// Pattern fragment: allocation balance counter (C)
// Adapt: integrate with your project's alloc/free wrappers
static _Atomic size_t g_alloc_count = 0;
static _Atomic size_t g_free_count = 0;

void* tracked_alloc(size_t size) {
    void* ptr = malloc(size);
    if (ptr) g_alloc_count++;  // only count successful allocations
    return ptr;
}
void tracked_free(void* ptr) { if (ptr) { g_free_count++; free(ptr); } }

size_t outstanding() { return g_alloc_count - g_free_count; }
// ASSERT: outstanding() after stress == outstanding() at baseline
```

### Rust Ownership Tracking

```rust
// Pattern fragment: Drop-based object counting
use std::sync::atomic::{AtomicUsize, Ordering};
static LIVE: AtomicUsize = AtomicUsize::new(0);

struct Tracked { /* fields */ }
impl Tracked {
    fn new() -> Self { LIVE.fetch_add(1, Ordering::SeqCst); Self { /* ... */ } }
}
impl Drop for Tracked {
    fn drop(&mut self) { LIVE.fetch_sub(1, Ordering::SeqCst); }
}

// In test:
let baseline = LIVE.load(Ordering::SeqCst);
// ... stress creating/dropping Tracked objects ...
let after = LIVE.load(Ordering::SeqCst);
let delta = after as isize - baseline as isize;  // signed to handle negative
assert_eq!(delta, 0, "Leaked {} objects", delta);
```

### GPU Memory Queries

```bash
# Pattern fragment: NVIDIA GPU memory per process
nvidia-smi --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits
# Returns MiB per process — diff before/after stress

# Monitoring over time
watch -n 1 'nvidia-smi --query-compute-apps=used_gpu_memory --format=csv,noheader'
```

```swift
// Pattern fragment: Metal GPU memory (macOS/iOS)
import Metal
let device = MTLCreateSystemDefaultDevice()!
let allocatedBytes = device.currentAllocatedSize
// Measure before and after stress, assert bounded growth
```

## Measurement Recipe (Pseudocode)

```
compile with -fsanitize=address,leak (or run under Valgrind)
OR set up application-level resource tracking

WARMUP: run typical workload cycle (init pools, caches, lazy alloc)
BASELINE: count outstanding allocations / GPU memory

STRESS: run workload cycle N times (each cycle must explicitly cleanup)
AFTER: count same metrics

ASSERT: outstanding growth == 0 (or < small tolerance for lazy init)
ASSERT: GPU memory growth < budget
ON FAILURE: ASan/LSan stack traces OR Valgrind report OR resource registry dump
```

## Anti-Patterns (Things Agents Must Avoid)

- Using C `assert()` for test assertions (takes single expression, no formatted message)
- `ptr = realloc(ptr, size)` (loses original on failure — use temp variable)
- Relying on process exit to free resources in long-running services
- Testing without sanitizers in CI (misses leaks that only manifest under specific inputs)
- Assuming Rust safe code can't leak (`Rc` cycles, `mem::forget`, spawned tasks)
- Measuring GPU memory via CPU-side tools (Valgrind/ASan don't see GPU allocations)

## Common GPU API Leak Sources

- Textures created per frame without deletion
- Framebuffers/render targets accumulated across passes
- Shader programs not deleted after pipeline rebuild
- Vertex/index buffers not returned to pool
- Command buffers not recycled (Vulkan/Metal)
- Descriptor sets allocated without free (Vulkan)
- Swap chain images not released on resize

## Common Native (CPU) Leak Sources

- `malloc`/`new` without `free`/`delete` in error paths (early returns, exceptions)
- `realloc` losing original pointer on failure
- `strdup()`/`asprintf()` without corresponding `free()`
- `mmap` without `munmap` (RSS grows permanently)
- File descriptors not closed
- Shared memory segments (`shmget`/`shm_open`) without cleanup
- DMA/ION buffers on embedded/mobile not freed

## Prevention: RAII and Ownership

The primary prevention pattern for native code is ownership-based resource management:

```cpp
// C++ RAII — resource freed in destructor, exception-safe
class TextureHandle {
    GLuint id_;
public:
    TextureHandle() { glGenTextures(1, &id_); }
    ~TextureHandle() { glDeleteTextures(1, &id_); }
    // Non-copyable, moveable
    TextureHandle(const TextureHandle&) = delete;
    TextureHandle(TextureHandle&& other) : id_(other.id_) { other.id_ = 0; }
};
```

```rust
// Rust ownership — compiler-enforced cleanup
struct GpuBuffer { handle: u64 }
impl Drop for GpuBuffer {
    fn drop(&mut self) { unsafe { gpu_free(self.handle); } }
}
// Buffer freed when owner goes out of scope — no manual cleanup needed
```

## Failure Diagnosis

| Signal | Next Step |
|---|---|
| ASan reports leak at exit | Stack trace points directly to allocation site |
| Valgrind "definitely lost" | Follow allocation trace → find missing free path |
| GPU memory growing per frame | Resource registry → identify accumulating type |
| RSS growing, no ASan report | mmap/shmem leak → check `vmmap`/`pmap` for growing regions |
| FD count growing | `ls /proc/<pid>/fd` or `lsof -p <pid>` → identify type |

## CI Configuration

```bash
# C/C++ with sanitizers
export CFLAGS="-fsanitize=address,leak -fno-omit-frame-pointer -g"
export LDFLAGS="-fsanitize=address,leak"
make test  # LSan reports leaks at exit with stack traces

# Rust
RUSTFLAGS="-Zsanitizer=address" cargo +nightly test

# GPU (software rendering for headless CI)
export LIBGL_ALWAYS_SOFTWARE=1  # Mesa llvmpipe
./run_gpu_tests

# NVIDIA in Docker CI
docker run --gpus all myapp-tests
```

## Agent Adaptation Checklist

Before generating a runnable test, fill in:
- [ ] Language (C, C++, Rust, mixed)
- [ ] Graphics API (Vulkan, Metal, OpenGL, DX12, WebGPU, none)
- [ ] Build system (CMake, Meson, Cargo, Makefile)
- [ ] Whether sanitizers are available in CI
- [ ] Whether application-level resource tracking exists
- [ ] Target workload cycle (render frame, process data, etc.)
- [ ] Budget per metric (outstanding objects, GPU MB, FD count)
- [ ] Whether GPU is available in CI (or software fallback)
- [ ] Whether this is diagnostic-only or promoted gate
