import { expect, test, vi } from "vitest";
import { waitForHttpOk } from "../http.js";

test("a listening service is not ready until its configured HTTP probe accepts it", async () => {
  const statuses = [false, true];
  const probe = vi.fn(async ({ url, timeoutMs }: { url: string; timeoutMs: number }) => {
    expect(url).toBe("https://localhost:3002/readyz");
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(5000);
    return statuses.shift() ?? false;
  });
  await expect(waitForHttpOk("https://localhost:3002/readyz", { timeoutMs: 5000, probe })).resolves.toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});

test("a failed boot whose readiness probe never accepts times out", async () => {
  const probe = vi.fn(async () => false);
  await expect(waitForHttpOk("https://localhost:3002/readyz", { timeoutMs: 1, probe })).rejects.toThrow("timed out waiting for");
});
