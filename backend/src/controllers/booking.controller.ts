import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const bookingStatusSchema = z.enum([
  "REQUESTED",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
]);

const bookingAcceptanceStatusSchema = z.enum([
  "PENDING_ACCEPTANCE",
  "ACCEPTED",
  "DECLINED",
]);

const bookingOutcomeSchema = z.enum(["PENDING", "WON", "LOST", "FOLLOW_UP"]);

const createBookingSchema = z.object({
  customerId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  callId: z.string().nullable().optional(),
  title: z.string().min(1),
  dateTime: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  status: bookingStatusSchema.optional(),
  assignedUserId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  proposalSent: z.boolean().optional(),
  outcome: bookingOutcomeSchema.optional(),
});

const updateBookingSchema = z.object({
  title: z.string().min(1).optional(),
  dateTime: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  status: bookingStatusSchema.optional(),
  assignedUserId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  proposalSent: z.boolean().optional(),
  outcome: bookingOutcomeSchema.optional(),
});

function buildRecordingMediaUrl(call: any) {
  if (!call?.id) return null;
  if (!call.recordingUrl && !call.recordingSid) return null;
  return `/api/calls/${call.id}/recording/media`;
}

function buildTranscriptFromMessages(
  messages: Array<{
    senderType: string;
    body: string;
    createdAt: Date;
  }> = []
) {
  return messages
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "Customer"
          : message.senderType === "AI"
            ? "AI"
            : "Human";

      return `[${message.createdAt.toISOString()}] ${speaker}: ${message.body}`;
    })
    .join("\n");
}

function attachBookingComputedFields<T extends Record<string, any>>(booking: T) {
  const conversation = booking.conversation;

  if (!conversation) {
    return {
      ...booking,
      latestCall: null,
      recordingMediaUrl: null,
      computedTranscript: "",
    };
  }

  const calls = Array.isArray(conversation.calls)
    ? conversation.calls.map((call: any) => ({
        ...call,
        recordingMediaUrl: buildRecordingMediaUrl(call),
      }))
    : [];

  const latestCall = calls[0] || null;

  return {
    ...booking,
    conversation: {
      ...conversation,
      calls,
      latestCall,
      computedTranscript: buildTranscriptFromMessages(conversation.messages || []),
    },
    latestCall,
    recordingMediaUrl: latestCall?.recordingMediaUrl || null,
    computedTranscript: buildTranscriptFromMessages(conversation.messages || []),
  };
}

function buildBookingIncludes() {
  return {
    customer: true,
    assignedUser: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
    acceptedBy: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
    call: {
      select: {
        id: true,
        status: true,
        direction: true,
        createdAt: true,
        transcript: true,
        recordingUrl: true,
        recordingSid: true,
      },
    },
    conversation: {
      include: {
        customer: true,
        messages: {
          orderBy: {
            createdAt: "asc" as const,
          },
          take: 50,
        },
        tasks: {
          orderBy: {
            createdAt: "desc" as const,
          },
          take: 10,
        },
        calls: {
          orderBy: {
            createdAt: "desc" as const,
          },
          take: 5,
        },
      },
    },
  };
}

export async function getBookings(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const companyId = req.user.companyId;
    const { status, search } = req.query;

    const where: Prisma.BookingWhereInput = {
      companyId,
    };

    if (status && typeof status === "string" && status !== "ALL") {
      where.status = status as any;
    }

    if (search && typeof search === "string" && search.trim()) {
      const searchText = search.trim();

      where.OR = [
        {
          title: {
            contains: searchText,
            mode: "insensitive",
          },
        },
        {
          customer: {
            fullName: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
        {
          customer: {
            phone: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
        {
          conversation: {
            aiSummary: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
        {
          conversation: {
            lastMessage: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
        {
          conversation: {
            messages: {
              some: {
                body: {
                  contains: searchText,
                  mode: "insensitive",
                },
              },
            },
          },
        },
      ];
    }

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: [
        {
          createdAt: "desc",
        },
      ],
      include: buildBookingIncludes(),
    });

    const rows = bookings.map(attachBookingComputedFields);

    const summary = {
      total: bookings.length,
      requested: bookings.filter((booking) => booking.status === "REQUESTED").length,
      confirmed: bookings.filter((booking) => booking.status === "CONFIRMED").length,
      cancelled: bookings.filter((booking) => booking.status === "CANCELLED").length,
      completed: bookings.filter((booking) => booking.status === "COMPLETED").length,
      noShow: bookings.filter((booking) => booking.status === "NO_SHOW").length,
      withRecording: rows.filter((booking) => Boolean(booking.recordingMediaUrl)).length,
      aiCallRequests: rows.filter(
        (booking) => booking.conversation?.channel === "AI_CALL"
      ).length,
    };

    return res.json({
      bookings: rows,
      summary,
    });
  } catch (error) {
    console.error("Get bookings error:", error);

    return res.status(500).json({
      message: "Failed to fetch bookings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getBookingById(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const booking = await prisma.booking.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: buildBookingIncludes(),
    });

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    return res.json({
      booking: attachBookingComputedFields(booking),
    });
  } catch (error) {
    console.error("Get booking error:", error);

    return res.status(500).json({
      message: "Failed to fetch booking",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createBooking(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createBookingSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const companyId = req.user.companyId;
    const {
      customerId,
      conversationId,
      callId,
      title,
      dateTime,
      timezone,
      purpose,
      status,
      assignedUserId,
      notes,
      nextAction,
      proposalSent,
      outcome,
    } = result.data;

    let conversation:
      | {
          id: string;
          customerId: string | null;
        }
      | null = null;

    if (conversationId) {
      conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId,
        },
        select: {
          id: true,
          customerId: true,
        },
      });

      if (!conversation) {
        return res.status(404).json({
          message: "Conversation not found",
        });
      }
    }

    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          companyId,
        },
      });

      if (!customer) {
        return res.status(404).json({
          message: "Customer not found",
        });
      }
    }

    if (callId) {
      const call = await prisma.call.findFirst({
        where: {
          id: callId,
          conversation: {
            companyId,
          },
        },
      });

      if (!call) {
        return res.status(404).json({
          message: "Call not found",
        });
      }
    }

    if (assignedUserId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assignedUserId,
          companyId,
          isActive: true,
        },
      });

      if (!assignee) {
        return res.status(404).json({
          message: "Assigned user not found",
        });
      }
    }

    const booking = await prisma.booking.create({
      data: {
        companyId,
        customerId: customerId || conversation?.customerId || undefined,
        conversationId: conversationId || undefined,
        callId: callId || undefined,
        title,
        dateTime:
          dateTime === undefined || dateTime === null || dateTime === ""
            ? null
            : new Date(dateTime),
        timezone: timezone || undefined,
        purpose: purpose || undefined,
        status: status || "REQUESTED",
        acceptanceStatus: assignedUserId ? "PENDING_ACCEPTANCE" : "PENDING_ACCEPTANCE",
        assignedUserId: assignedUserId || undefined,
        notes: notes || undefined,
        nextAction: nextAction || undefined,
        proposalSent: proposalSent ?? false,
        proposalSentAt: proposalSent ? new Date() : undefined,
        outcome: outcome || "PENDING",
      },
      include: buildBookingIncludes(),
    });

    if (conversationId) {
      await prisma.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          bookingCreated: true,
          status: "FOLLOW_UP",
          humanNeeded: true,
          nextAction: "Booking request created. Staff should confirm it.",
          updatedAt: new Date(),
        },
      });
    }

    return res.status(201).json({
      message: "Booking created",
      booking: attachBookingComputedFields(booking),
    });
  } catch (error) {
    console.error("Create booking error:", error);

    return res.status(500).json({
      message: "Failed to create booking",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateBooking(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateBookingSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    const existingBooking = await prisma.booking.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingBooking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    const { title, dateTime, timezone, purpose, status, assignedUserId, notes, nextAction, proposalSent, outcome } =
      result.data;

    const updateData: Prisma.BookingUpdateInput = {
      title,
      dateTime:
        dateTime === undefined
          ? undefined
          : dateTime === null || dateTime === ""
            ? null
            : new Date(dateTime),
      timezone: timezone === undefined ? undefined : timezone,
      purpose: purpose === undefined ? undefined : purpose,
      status,
      notes: notes === undefined ? undefined : notes,
      nextAction: nextAction === undefined ? undefined : nextAction,
      outcome,
    };

    if (assignedUserId !== undefined) {
      if (assignedUserId) {
        const assignee = await prisma.user.findFirst({
          where: {
            id: assignedUserId,
            companyId: req.user.companyId,
            isActive: true,
          },
        });

        if (!assignee) {
          return res.status(404).json({
            message: "Assigned user not found",
          });
        }
      }

      updateData.assignedUser = assignedUserId
        ? { connect: { id: assignedUserId } }
        : { disconnect: true };
      updateData.acceptanceStatus = "PENDING_ACCEPTANCE";
      updateData.acceptedAt = null;
      updateData.acceptedBy = { disconnect: true };
    }

    if (proposalSent !== undefined) {
      updateData.proposalSent = proposalSent;
      updateData.proposalSentAt = proposalSent ? new Date() : null;
    }

    if (status === "CANCELLED") {
      updateData.cancelledAt = new Date();
    }

    if (status === "COMPLETED") {
      updateData.completedAt = new Date();
    }

    const booking = await prisma.booking.update({
      where: {
        id,
      },
      data: updateData,
      include: buildBookingIncludes(),
    });

    if (booking.conversationId && status) {
      const conversationStatus =
        status === "CONFIRMED"
          ? "CONVERTED"
          : status === "CANCELLED" || status === "NO_SHOW"
            ? "LOST"
            : status === "COMPLETED"
              ? "CONVERTED"
              : "FOLLOW_UP";

      await prisma.conversation.update({
        where: {
          id: booking.conversationId,
        },
        data: {
          status: conversationStatus,
          bookingCreated: true,
          humanNeeded: status === "REQUESTED",
          nextAction:
            status === "CONFIRMED"
              ? "Booking confirmed. Staff should prepare for the customer."
              : status === "CANCELLED"
                ? "Booking cancelled. Staff may follow up if needed."
                : status === "NO_SHOW"
                  ? "Customer did not show. Staff should decide whether to follow up."
                  : status === "COMPLETED"
                    ? "Booking completed."
                    : "Booking needs staff follow-up.",
          updatedAt: new Date(),
        },
      });
    }

    return res.json({
      message: "Booking updated",
      booking: attachBookingComputedFields(booking),
    });
  } catch (error) {
    console.error("Update booking error:", error);

    return res.status(500).json({
      message: "Failed to update booking",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function acceptBooking(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const booking = await prisma.booking.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    if (!booking.assignedUserId) {
      return res.status(400).json({
        message: "Booking has no assigned employee to accept",
      });
    }

    if (booking.assignedUserId !== req.user.userId) {
      return res.status(403).json({
        message: "Only the assigned employee can accept this booking",
      });
    }

    if (booking.acceptanceStatus === "ACCEPTED") {
      return res.status(409).json({
        message: "Booking already accepted",
      });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        acceptanceStatus: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedByUserId: req.user.userId,
      },
      include: buildBookingIncludes(),
    });

    return res.json({
      message: "Booking accepted",
      booking: attachBookingComputedFields(updated),
    });
  } catch (error) {
    console.error("Accept booking error:", error);

    return res.status(500).json({
      message: "Failed to accept booking",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}