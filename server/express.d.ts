import type { User } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionKey?: string;
      companyId?: number;
    }
  }
}

export {};
