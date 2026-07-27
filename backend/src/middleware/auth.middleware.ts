import { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";

type AuthPayload = {
  userId: string;
  companyId: string;
  role: string;
  industry?: string | null;
};

export type AuthRequest = Request<Record<string, string>> & {
  user?: AuthPayload;
};

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error("JWT_SECRET is missing");
    }

    const decoded = jwt.verify(token, jwtSecret) as unknown as AuthPayload;

    req.user = {
      userId: decoded.userId,
      companyId: decoded.companyId,
      role: decoded.role,
      industry: decoded.industry,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}