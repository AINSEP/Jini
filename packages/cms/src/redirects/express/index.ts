/** Express binding; origin and reserved-path decisions remain in the required resolver. */
import type { NextFunction, Request, Response } from "express";
import type { RedirectResolutionReport, RedirectResolverWithRefusals, RouteResolveContext } from "../ports.js";
import type { RedirectResolvePhase } from "../types.js";

export class RedirectMiddlewareContextError extends Error {
  constructor(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    super("redirect middleware requires res.locals.redirectContext.workspaceId");
    this.name = "RedirectMiddlewareContextError";
  }
}
export type RedirectMiddlewareResult = RedirectResolutionReport | { error: unknown };
export type RedirectMiddleware = (request: Request, response: Response, next: NextFunction) => Promise<RedirectMiddlewareResult>;

/**
 * Adapt a gate-owning resolver to Express. The host supplies res.locals.redirectContext;
 * workspace identity is never inferred from an untrusted Host header or from a product default.
 * @param required Resolver with the required oracle/reserved-segment gate and refusal reporting.
 * @param optional Phase; mount pre_content before content routes or post_content after them.
 * @returns Middleware: redirects approved Locations, exposes refusals in locals/return, otherwise next().
 * @throws Errors are forwarded to next(error) and retained in the returned error outcome.
 * @complexity O(1) adapter work, plus the required resolver's bounded work.
 * @example app.use(createRedirectMiddleware({ resolver }, { phase: "post_content" }));
 */
export function createRedirectMiddleware(
  { resolver }: { resolver: RedirectResolverWithRefusals },
  { phase = "post_content" }: { phase?: RedirectResolvePhase } = {},
): RedirectMiddleware {
  return async (request, response, next) => {
    try {
      const context = response.locals.redirectContext as RouteResolveContext | undefined;
      if (typeof context?.workspaceId !== "string" || context.workspaceId.length === 0) throw new RedirectMiddlewareContextError({}, {});
      const report = await resolver.resolveWithRefusals({ workspaceId: context.workspaceId, path: request.path, phase }, {});
      response.locals.redirectRefusals = report.refused;
      if (!report.resolution.matched) {
        next();
        return report;
      }
      // INV-03: the required resolver has checked this exact interpolated Location. No second
      // template substitution or target reconstruction occurs between that verdict and Express.
      response.redirect(report.resolution.statusCode, report.resolution.location);
      return report;
    } catch (error) {
      next(error);
      return { error };
    }
  };
}
