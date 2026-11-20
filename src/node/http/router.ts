// A tiny route table: (method, regex) -> handler.
import type { RequestContext } from './context.js';

export type Handler = (ctx: RequestContext) => void | Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  /** Needs a known device (X-Device header). */
  auth: boolean;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, auth = false): void {
    this.routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler, auth });
  }

  /** First matching route (routes are checked in the order they were added). */
  resolve(method: string, path: string): { route: Route; params: string[] } | undefined {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(path);
      if (match) return { route, params: match.slice(1) };
    }
    return undefined;
  }
}
