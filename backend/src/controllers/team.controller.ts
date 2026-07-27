import { Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const inviteMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["OWNER", "ADMIN", "STAFF"]).default("STAFF"),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  workloadCapacity: z.number().int().min(1).max(50).default(8),
});

const updateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["OWNER", "ADMIN", "STAFF"]).optional(),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  workloadCapacity: z.number().int().min(1).max(50).optional(),
});

const deactivateMemberSchema = z.object({
  taskStrategy: z
    .enum(["MOVE_TO_UNASSIGNED", "REASSIGN", "KEEP_ASSIGNED"])
    .default("MOVE_TO_UNASSIGNED"),
  reassignToUserId: z.string().nullable().optional(),
});

function cleanText(value?: string | null, fallback = "Customer work") {
  if (!value) return fallback;

  const lower = value.toLowerCase();

  if (
    lower.includes("test customer") ||
    lower.includes("llm test") ||
    lower.includes("real whatsapp customer") ||
    lower.includes("call test customer") ||
    lower.includes("live/testing")
  ) {
    return fallback;
  }

  return value;
}

function isSetupTask(task: any) {
  const text = `${task.title || ""} ${task.description || ""} ${
    task.aiNotes || ""
  }`.toLowerCase();

  return (
    text.includes("connect ai call agent") ||
    text.includes("live/testing call agent") ||
    text.includes("no live/testing call agent") ||
    text.includes("call agent is configured")
  );
}

function isDelayed(task: { dueAt?: Date | null; status: string }) {
  if (!task.dueAt || task.status === "DONE") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function getCustomerName(task: any) {
  return cleanText(
    task.customer?.fullName ||
      task.conversation?.customer?.fullName ||
      task.customer?.phone ||
      task.conversation?.customer?.phone,
    "Customer Inquiry"
  );
}

function getTaskType(task: any) {
  const text = `${task.title || ""} ${task.description || ""} ${
    task.aiNotes || ""
  }`.toLowerCase();

  if (
    text.includes("chest pain") ||
    text.includes("breathing") ||
    text.includes("severe pain") ||
    text.includes("emergency") ||
    text.includes("urgent medical")
  ) {
    return "Emergency";
  }

  if (
    text.includes("callback") ||
    text.includes("call back") ||
    text.includes("missed call")
  ) {
    return "Callback";
  }

  if (
    text.includes("appointment") ||
    text.includes("booking") ||
    text.includes("confirm")
  ) {
    return "Appointment";
  }

  if (text.includes("payment")) return "Payment";
  if (text.includes("follow up") || text.includes("follow-up")) return "Follow-up";

  if (task.conversation?.channel === "WHATSAPP") return "WhatsApp";
  if (task.conversation?.channel === "AI_CALL") return "Call";
  if (task.conversation?.channel === "WEBSITE_CHAT") return "Website";

  return "General";
}

function getSource(task: any) {
  if (task.conversation?.channel === "WHATSAPP") return "WhatsApp";
  if (task.conversation?.channel === "AI_CALL") return "Call";
  if (task.conversation?.channel === "WEBSITE_CHAT") return "Website";
  return "Manual";
}

function getDelayLabel(task: any) {
  if (!isDelayed(task)) return "On time";

  const diff = Date.now() - new Date(task.dueAt).getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} late`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} late`;

  const minutes = Math.floor(diff / 60000);
  return `${minutes} minute${minutes === 1 ? "" : "s"} late`;
}

function buildTaskPreview(task: any) {
  return {
    id: task.id,
    title: cleanText(task.title, "Customer task"),
    description: cleanText(task.description, ""),
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    delayed: isDelayed(task),
    delayLabel: getDelayLabel(task),
    customerName: getCustomerName(task),
    taskType: getTaskType(task),
    source: getSource(task),
    blockedReason: task.blockedReason || null,
    aiNotes: cleanText(task.aiNotes, "AI reason is not available yet"),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function buildMemberRow(input: {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  deactivatedAt?: Date | null;
  department?: string | null;
  jobTitle?: string | null;
  workloadCapacity: number;
  type: "USER" | "UNASSIGNED" | "MANUAL";
  tasks: any[];
}) {
  const activeTasks = input.tasks.filter((task) =>
    ["OPEN", "DOING"].includes(task.status)
  );

  const completedTasks = input.tasks.filter((task) => task.status === "DONE");
  const delayedTasks = input.tasks.filter((task) => isDelayed(task));
  const blockedTasks = input.tasks.filter((task) => task.status === "BLOCKED");
  const criticalTasks = input.tasks.filter(
    (task) => task.priority === "CRITICAL"
  );

  const openWorkload = activeTasks.length + blockedTasks.length;
  const capacity = input.workloadCapacity || 8;
  const workloadPercent = Math.round((openWorkload / capacity) * 100);

  const reasons: string[] = [];

  if (!input.isActive) {
    reasons.push("This member is inactive.");
  }

  if (input.type === "UNASSIGNED" && input.tasks.length > 0) {
    reasons.push(
      `${input.tasks.length} unassigned task${
        input.tasks.length === 1 ? "" : "s"
      } need manager action.`
    );
  }

  if (delayedTasks.length > 0) {
    reasons.push(
      `${delayedTasks.length} delayed task${
        delayedTasks.length === 1 ? "" : "s"
      }.`
    );
  }

  if (blockedTasks.length > 0) {
    reasons.push(
      `${blockedTasks.length} blocked task${
        blockedTasks.length === 1 ? "" : "s"
      }.`
    );
  }

  if (criticalTasks.length > 0) {
    reasons.push(
      `${criticalTasks.length} critical task${
        criticalTasks.length === 1 ? "" : "s"
      }.`
    );
  }

  if (workloadPercent >= 120) {
    reasons.push("Workload is above capacity.");
  } else if (workloadPercent >= 90) {
    reasons.push("Workload is close to capacity.");
  }

  if (input.isActive && input.tasks.length === 0 && input.type === "USER") {
    reasons.push("No work assigned yet.");
  }

  const needsAttention =
    input.type === "UNASSIGNED"
      ? input.tasks.length > 0
      : input.isActive &&
        (delayedTasks.length > 0 ||
          blockedTasks.length > 0 ||
          criticalTasks.length > 0 ||
          workloadPercent >= 120);

  let status = "Stable";
  let statusTone = "normal";

  if (!input.isActive) {
    status = "Inactive";
    statusTone = "muted";
  } else if (input.type === "UNASSIGNED" && input.tasks.length > 0) {
    status = "Manager action";
    statusTone = "danger";
  } else if (workloadPercent >= 120) {
    status = "Overloaded";
    statusTone = "danger";
  } else if (needsAttention) {
    status = "Needs attention";
    statusTone = "warning";
  } else if (input.tasks.length === 0) {
    status = "No work";
    statusTone = "muted";
  } else if (completedTasks.length > 0 && delayedTasks.length === 0) {
    status = "Doing well";
    statusTone = "success";
  }

  let score: number | null = null;
  let scoreLabel = "Not enough data";

  if (input.isActive && input.tasks.length >= 5 && input.type === "USER") {
    score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          82 +
            completedTasks.length * 3 -
            delayedTasks.length * 14 -
            blockedTasks.length * 10 -
            Math.max(0, workloadPercent - 100) * 0.4
        )
      )
    );

    if (score >= 85) scoreLabel = "Excellent";
    else if (score >= 70) scoreLabel = "Stable";
    else if (score >= 50) scoreLabel = "Needs support";
    else scoreLabel = "Needs attention";
  }

  const latestTask = [...input.tasks].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];

  const activeTaskList = activeTasks.slice(0, 8).map(buildTaskPreview);
  const delayedTaskList = delayedTasks.slice(0, 8).map(buildTaskPreview);
  const blockedTaskList = blockedTasks.slice(0, 8).map(buildTaskPreview);
  const completedTaskList = completedTasks.slice(0, 8).map(buildTaskPreview);

  return {
    id: input.id,
    name: input.name,
    email: input.email,
    role: input.role,
    isActive: input.isActive,
    deactivatedAt: input.deactivatedAt || null,
    department: input.department || null,
    jobTitle: input.jobTitle || null,
    workloadCapacity: capacity,
    type: input.type,

    status,
    statusTone,
    needsAttention,
    workloadPercent,
    workloadLabel:
      workloadPercent >= 120
        ? "Overloaded"
        : workloadPercent >= 90
          ? "Heavy"
          : workloadPercent >= 40
            ? "Normal"
            : openWorkload > 0
              ? "Light"
              : "No active work",

    score,
    scoreLabel,
    scoreReason:
      score === null
        ? "Needs at least 5 task records to calculate performance."
        : "Based on completed work, delayed work, blocked work and workload capacity.",

    activeTasks: activeTasks.length,
    completedTasks: completedTasks.length,
    delayedTasks: delayedTasks.length,
    blockedTasks: blockedTasks.length,
    criticalTasks: criticalTasks.length,
    totalTasks: input.tasks.length,

    reasons: reasons.length ? reasons : ["No major issue detected."],

    activeTaskList,
    delayedTaskList,
    blockedTaskList,
    completedTaskList,

    lastActiveAt: latestTask?.updatedAt || null,
  };
}

function buildAttentionQueue(members: any[]) {
  return members
    .filter(
      (member) =>
        member.needsAttention ||
        (member.type === "UNASSIGNED" && member.totalTasks > 0)
    )
    .map((member) => ({
      id: member.id,
      name: member.name,
      status: member.status,
      reason: member.reasons[0] || "Needs manager attention",
      workloadPercent: member.workloadPercent,
      activeTasks: member.activeTasks,
      delayedTasks: member.delayedTasks,
      blockedTasks: member.blockedTasks,
      criticalTasks: member.criticalTasks,
    }));
}

export async function getTeamOverview(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const companyId = req.user.companyId;

    const [users, tasks] = await Promise.all([
      prisma.user.findMany({
        where: {
          companyId,
        },
        orderBy: [
          {
            isActive: "desc",
          },
          {
            name: "asc",
          },
        ],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          deactivatedAt: true,
          department: true,
          jobTitle: true,
          workloadCapacity: true,
          createdAt: true,
        },
      }),

      prisma.task.findMany({
        where: {
          companyId,
        },
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
            },
          },
          customer: true,
          conversation: {
            include: {
              customer: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    const cleanTasks = tasks.filter((task) => !isSetupTask(task));

    const userRows = users.map((user) =>
      buildMemberRow({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        deactivatedAt: user.deactivatedAt,
        department: user.department,
        jobTitle: user.jobTitle,
        workloadCapacity: user.workloadCapacity,
        type: "USER",
        tasks: cleanTasks.filter((task) => task.assignedUserId === user.id),
      })
    );

    const unassignedRow = buildMemberRow({
      id: "UNASSIGNED",
      name: "Unassigned Work",
      email: null,
      role: "Manager action needed",
      isActive: true,
      deactivatedAt: null,
      department: null,
      jobTitle: null,
      workloadCapacity: 8,
      type: "UNASSIGNED",
      tasks: cleanTasks.filter((task) => !task.assignedUserId && !task.owner),
    });

    const members = [...userRows, unassignedRow].sort((a, b) => {
      if (a.type === "UNASSIGNED") return -1;
      if (b.type === "UNASSIGNED") return 1;
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      if (a.needsAttention && !b.needsAttention) return -1;
      if (!a.needsAttention && b.needsAttention) return 1;
      return b.workloadPercent - a.workloadPercent;
    });

    const activeUsers = users.filter((user) => user.isActive);
    const inactiveUsers = users.filter((user) => !user.isActive);

    return res.json({
      summary: {
        totalMembers: users.length,
        activeMembers: activeUsers.length,
        inactiveMembers: inactiveUsers.length,
        overloaded: members.filter(
          (member) => member.type === "USER" && member.workloadPercent >= 120
        ).length,
        needsAttention: members.filter((member) => member.needsAttention).length,
        noWork: members.filter(
          (member) =>
            member.type === "USER" &&
            member.isActive &&
            member.activeTasks === 0 &&
            member.totalTasks === 0
        ).length,
        unassignedTasks: unassignedRow.totalTasks,
      },

      members,
      attentionQueue: buildAttentionQueue(members),
      teamMembers: users,

      modules: {
        deactivateEnabled: true,
        permissionsEnabled: false,
        attendanceEnabled: false,
      },
    });
  } catch (error) {
    console.error("Team overview error:", error);

    return res.status(500).json({
      message: "Failed to fetch team overview",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function inviteTeamMember(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "OWNER" && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Only owner or admin can invite team members",
      });
    }

    const result = inviteMemberSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid member input",
        errors: result.error.flatten(),
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: result.data.email,
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "A user with this email already exists",
      });
    }

    const password = await bcrypt.hash(result.data.password, 10);

    const user = await prisma.user.create({
      data: {
        companyId: req.user.companyId,
        name: result.data.name,
        email: result.data.email,
        password,
        role: result.data.role,
        department: result.data.department || null,
        jobTitle: result.data.jobTitle || null,
        workloadCapacity: result.data.workloadCapacity,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        jobTitle: true,
        workloadCapacity: true,
        isActive: true,
      },
    });

    return res.status(201).json({
      message: "Team member invited",
      member: user,
    });
  } catch (error) {
    console.error("Invite team member error:", error);

    return res.status(500).json({
      message: "Failed to invite team member",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateTeamMember(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "OWNER" && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Only owner or admin can update team members",
      });
    }

    const result = updateMemberSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid member input",
        errors: result.error.flatten(),
      });
    }

    const member = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!member) {
      return res.status(404).json({
        message: "Team member not found",
      });
    }

    const updated = await prisma.user.update({
      where: {
        id: member.id,
      },
      data: {
        name: result.data.name,
        role: result.data.role,
        department: result.data.department,
        jobTitle: result.data.jobTitle,
        workloadCapacity: result.data.workloadCapacity,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        jobTitle: true,
        workloadCapacity: true,
        isActive: true,
      },
    });

    return res.json({
      message: "Team member updated",
      member: updated,
    });
  } catch (error) {
    console.error("Update team member error:", error);

    return res.status(500).json({
      message: "Failed to update team member",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deactivateTeamMember(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "OWNER" && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Only owner or admin can deactivate team members",
      });
    }

    const result = deactivateMemberSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid deactivate input",
        errors: result.error.flatten(),
      });
    }

    const member = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!member) {
      return res.status(404).json({
        message: "Team member not found",
      });
    }

    if (member.id === req.user.userId) {
      return res.status(400).json({
        message: "You cannot deactivate yourself",
      });
    }

    if (member.role === "OWNER") {
      const activeOwners = await prisma.user.count({
        where: {
          companyId: req.user.companyId,
          role: "OWNER",
          isActive: true,
        },
      });

      if (activeOwners <= 1) {
        return res.status(400).json({
          message: "You cannot deactivate the last active owner",
        });
      }
    }

    if (result.data.taskStrategy === "REASSIGN") {
      if (!result.data.reassignToUserId) {
        return res.status(400).json({
          message: "Reassign user is required",
        });
      }

      const reassignUser = await prisma.user.findFirst({
        where: {
          id: result.data.reassignToUserId,
          companyId: req.user.companyId,
          isActive: true,
        },
      });

      if (!reassignUser) {
        return res.status(404).json({
          message: "Reassign user not found",
        });
      }

      await prisma.task.updateMany({
        where: {
          companyId: req.user.companyId,
          assignedUserId: member.id,
          status: {
            in: ["OPEN", "DOING", "BLOCKED"],
          },
        },
        data: {
          assignedUserId: reassignUser.id,
          owner: reassignUser.name,
        },
      });
    }

    if (result.data.taskStrategy === "MOVE_TO_UNASSIGNED") {
      await prisma.task.updateMany({
        where: {
          companyId: req.user.companyId,
          assignedUserId: member.id,
          status: {
            in: ["OPEN", "DOING", "BLOCKED"],
          },
        },
        data: {
          assignedUserId: null,
          owner: null,
        },
      });
    }

    const updated = await prisma.user.update({
      where: {
        id: member.id,
      },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
      },
    });

    return res.json({
      message: "Team member deactivated",
      member: updated,
    });
  } catch (error) {
    console.error("Deactivate team member error:", error);

    return res.status(500).json({
      message: "Failed to deactivate team member",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function reactivateTeamMember(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "OWNER" && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Only owner or admin can reactivate team members",
      });
    }

    const member = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!member) {
      return res.status(404).json({
        message: "Team member not found",
      });
    }

    const updated = await prisma.user.update({
      where: {
        id: member.id,
      },
      data: {
        isActive: true,
        deactivatedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
      },
    });

    return res.json({
      message: "Team member reactivated",
      member: updated,
    });
  } catch (error) {
    console.error("Reactivate team member error:", error);

    return res.status(500).json({
      message: "Failed to reactivate team member",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}