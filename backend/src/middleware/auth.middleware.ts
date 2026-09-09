import { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";

type AuthPayload = {
  userId: string;
  companyId: string;
  role: string;
  industry?: string | null;
};

export type AuthRequest = Request<Record<string, string>> & {
  user?: AuthPayload;
};

let localAuthPromise: Promise<AuthPayload> | null = null;

async function provisionLocalDevUser(): Promise<AuthPayload> {
  const email =
    process.env.LOCAL_AUTH_EMAIL?.trim().toLowerCase() ||
    "owner@local.airadesk";

  const name =
    process.env.LOCAL_AUTH_NAME?.trim() ||
    "Local Owner";

  const companyName =
    process.env.LOCAL_COMPANY_NAME?.trim() ||
    "AiraDesk Local";

  const preferredCompanyId =
    process.env.LOCAL_COMPANY_ID?.trim() ||
    process.env.VOICE_COMPANY_ID?.trim();

  // Reuse the local owner if already created.
  let user = await prisma.user.findUnique({
    where: {
      email,
    },
    include: {
      company: true,
    },
  });

  if (!user) {
    let company;

    if (preferredCompanyId) {
      company = await prisma.company.upsert({
        where: {
          id: preferredCompanyId,
        },
        update: {},
        create: {
          id: preferredCompanyId,
          name: companyName,
          industry: "OTHER",
        },
      });
    } else {
      company = await prisma.company.create({
        data: {
          name: companyName,
          industry: "OTHER",
        },
      });
    }

    // Password will never be used for local bypass.
    // Store a valid bcrypt hash anyway so the database remains structurally valid.
    const unusablePassword = await bcrypt.hash(
      `local-development-${Date.now()}-${Math.random()}`,
      10
    );

    user = await prisma.user.create({
      data: {
        companyId: company.id,
        name,
        email,
        password: unusablePassword,
        role: "OWNER",
      },
      include: {
        company: true,
      },
    });

    console.log(
      `[Local Auth] Created local OWNER: ${user.email} (${user.companyId})`
    );
  }

  return {
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    industry: user.company.industry,
  };
}

function getLocalDevUser() {
  if (!localAuthPromise) {
    localAuthPromise = provisionLocalDevUser().catch((error) => {
      localAuthPromise = null;
      throw error;
    });
  }

  return localAuthPromise;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const localBypassEnabled =
      process.env.NODE_ENV !== "production" &&
      process.env.LOCAL_AUTH_BYPASS === "true";

    // LOCAL DEVELOPMENT:
    // No login or JWT required.
    if (localBypassEnabled) {
      req.user = await getLocalDevUser();
      return next();
    }

    // NORMAL / PRODUCTION AUTH:
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

    const decoded = jwt.verify(
      token,
      jwtSecret
    ) as unknown as AuthPayload;

    req.user = {
      userId: decoded.userId,
      companyId: decoded.companyId,
      role: decoded.role,
      industry: decoded.industry,
    };

    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    return res.status(401).json({
      message: "Unauthorized",
    });
  }
}