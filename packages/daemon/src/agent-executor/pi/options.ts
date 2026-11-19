export function resolvePiGracefulShutdownMs({ value, env }: { value: number | undefined; env: NodeJS.ProcessEnv }, _optional: Record<string, never> = {}): number {
  return value ?? (Number(env.PI_GRACEFUL_SHUTDOWN_MS) || 5000);
}
