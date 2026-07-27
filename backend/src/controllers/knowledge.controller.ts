import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const createKnowledgeSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  content: z.string().min(1),
  isActive: z.boolean().optional(),
});

const updateKnowledgeSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().optional(),
  content: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function getKnowledgeItems(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { search, category, active } = req.query;

    const where: Prisma.KnowledgeItemWhereInput = {
      companyId: req.user.companyId,
    };

    if (category && typeof category === "string" && category !== "ALL") {
      where.category = category;
    }

    if (active && typeof active === "string" && active !== "ALL") {
      where.isActive = active === "true";
    }

    if (search && typeof search === "string") {
      where.OR = [
        {
          title: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          category: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          content: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const items = await prisma.knowledgeItem.findMany({
      where,
      orderBy: [
        {
          isActive: "desc",
        },
        {
          updatedAt: "desc",
        },
      ],
    });

    const categories = await prisma.knowledgeItem.groupBy({
      by: ["category"],
      where: {
        companyId: req.user.companyId,
      },
      _count: {
        category: true,
      },
      orderBy: {
        category: "asc",
      },
    });

    const summary = {
      total: items.length,
      active: items.filter((item) => item.isActive).length,
      inactive: items.filter((item) => !item.isActive).length,
      categories: categories.length,
    };

    return res.json({
      items,
      categories,
      summary,
    });
  } catch (error) {
    console.error("Get knowledge items error:", error);

    return res.status(500).json({
      message: "Failed to fetch knowledge items",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createKnowledgeItem(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createKnowledgeSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const item = await prisma.knowledgeItem.create({
      data: {
        companyId: req.user.companyId,
        title: result.data.title,
        category: result.data.category || "GENERAL",
        content: result.data.content,
        isActive:
          typeof result.data.isActive === "boolean"
            ? result.data.isActive
            : true,
      },
    });

    return res.status(201).json({
      message: "Knowledge item created",
      item,
    });
  } catch (error) {
    console.error("Create knowledge item error:", error);

    return res.status(500).json({
      message: "Failed to create knowledge item",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateKnowledgeItem(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateKnowledgeSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    const existingItem = await prisma.knowledgeItem.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingItem) {
      return res.status(404).json({
        message: "Knowledge item not found",
      });
    }

    const item = await prisma.knowledgeItem.update({
      where: {
        id,
      },
      data: result.data,
    });

    return res.json({
      message: "Knowledge item updated",
      item,
    });
  } catch (error) {
    console.error("Update knowledge item error:", error);

    return res.status(500).json({
      message: "Failed to update knowledge item",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteKnowledgeItem(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const existingItem = await prisma.knowledgeItem.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingItem) {
      return res.status(404).json({
        message: "Knowledge item not found",
      });
    }

    await prisma.knowledgeItem.delete({
      where: {
        id,
      },
    });

    return res.json({
      message: "Knowledge item deleted",
    });
  } catch (error) {
    console.error("Delete knowledge item error:", error);

    return res.status(500).json({
      message: "Failed to delete knowledge item",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}