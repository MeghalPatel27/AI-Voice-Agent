import { Request, Response } from "express";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const industryOptions = [
  "HOSPITAL",
  "CLINIC",
  "HOTEL",
  "RESTAURANT",
  "REAL_ESTATE",
  "OTHER",
] as const;

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  companyName: z.string().min(2),
  industry: z.enum(industryOptions),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function createToken(payload: {
  userId: string;
  companyId: string;
  role: string;
  industry?: string | null;
}) {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET is missing");
  }

  return jwt.sign(payload, jwtSecret, {
    expiresIn: "7d",
  });
}

export async function register(req: Request, res: Response) {
  try {
    const result = registerSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { name, email, password, companyName, industry } = result.data;

    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists with this email",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const company = await prisma.company.create({
      data: {
        name: companyName,
        industry,
        users: {
          create: {
            name,
            email,
            password: hashedPassword,
            role: "OWNER",
          },
        },
      },
      include: {
        users: true,
      },
    });

    const user = company.users[0];

    if (!user) {
      return res.status(500).json({
        message: "Account created but owner user was not provisioned",
      });
    }

    const token = createToken({
      userId: user.id,
      companyId: company.id,
      role: user.role,
      industry: company.industry,
    });

    return res.status(201).json({
      message: "Account created successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: company.id,
        companyName: company.name,
        industry: company.industry,
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      message: "Failed to register user",
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const result = loginSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { email, password } = result.data;

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      include: {
        company: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = createToken({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      industry: user.company.industry,
    });

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
        industry: user.company.industry,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Failed to login",
    });
  }
}

export async function getMe(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.userId,
      },
      include: {
        company: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
        industry: user.company.industry,
      },
    });
  } catch (error) {
    console.error("Get me error:", error);

    return res.status(500).json({
      message: "Failed to fetch user",
    });
  }
}