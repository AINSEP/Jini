export function resolvePiGracefulShutdownMs(value: number | undefined, env: NodeJS.ProcessEnv): number {
  return value ?? (Number(env.PI_GRACEFUL_SHUTDOWN_MS) || 5000);
}
