import type { AuthContext } from "@disaster/shared-types";

declare global {
  namespace Express {
    interface Locals {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

export {};
