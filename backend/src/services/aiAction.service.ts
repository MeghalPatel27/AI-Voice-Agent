import { Prisma } from "@prisma/client";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type Channel = "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
type Industry =
  | "HOSPITAL"
  | "CLINIC"
  | "HOTEL"
  | "RESTAURANT"
  | "REAL_ESTATE"
  | "OTHER";

type AiActionInput = {
  tx: Prisma.TransactionClient;
  companyId: string;
  customerId: string;
  conversationId: string;
  companyName: string;
  industry: Industry;
  channel: Channel;
  text: string;
  intent: string;
  aiSummary: string;
  priority: Priority;
  humanNeeded: boolean;
  taskTitle?: string;
  nextAction: string;
};

type AiActionResult = {
  bookingCreated: boolean;
  booking: unknown | null;
  task: unknown | null;
  actionSummary: string;
};

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function hasTimeSignal(text: string) {
  return /\b([01]?\d|2[0-3])(:[0-5]\d)?\s?(am|pm)?\b/i.test(text);
}

function hasDateSignal(text: string) {
  const weekdays = [
    "today",
    "tomorrow",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];

  return (
    includesAny(text, weekdays) ||
    includesAny(text, months) ||
    /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/.test(text)
  );
}

function hasBookingConfirmationSignal(text: string) {
  return includesAny(text, [
    "book",
    "booking",
    "appointment",
    "confirm",
    "confirmed",
    "yes book",
    "yes confirm",
    "reserve",
    "reservation",
    "schedule",
    "slot",
    "site visit",
    "table",
    "room",
  ]);
}

function shouldCreateBooking(input: AiActionInput) {
  const text = normalize(input.text);

  if (
    input.intent !== "booking_request" &&
    input.intent !== "conversion_signal"
  ) {
    return false;
  }

  return (
    hasBookingConfirmationSignal(text) ||
    hasDateSignal(text) ||
    hasTimeSignal(text)
  );
}

function buildBookingTitle(industry: Industry) {
  if (industry === "HOSPITAL" || industry === "CLINIC") {
    return "Appointment request";
  }

  if (industry === "HOTEL") {
    return "Guest booking request";
  }

  if (industry === "RESTAURANT") {
    return "Table booking request";
  }

  if (industry === "REAL_ESTATE") {
    return "Site visit request";
  }

  return "Booking request";
}

function parseSimpleDateTime(textInput: string) {
  const text = normalize(textInput);
  const now = new Date();
  const date = new Date();

  if (text.includes("tomorrow")) {
    date.setDate(now.getDate() + 1);
  }

  const timeMatch = text.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s?(am|pm)?\b/i);

  if (!timeMatch) {
    return undefined;
  }

  let hours = Number(timeMatch[1]);
  const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0;
  const meridiem = timeMatch[3]?.toLowerCase();

  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  }

  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  date.setHours(hours, minutes, 0, 0);

  return date;
}

async function findOpenTask(input: AiActionInput) {
  return input.tx.task.findFirst({
    where: {
      companyId: input.companyId,
      conversationId: input.conversationId,
      status: {
        in: ["OPEN", "DOING"],
      },
    },
  });
}

async function createOrReuseHumanTask(input: AiActionInput) {
  const existingTask = await findOpenTask(input);

  if (existingTask) {
    return existingTask;
  }

  return input.tx.task.create({
    data: {
      companyId: input.companyId,
      conversationId: input.conversationId,
      customerId: input.customerId,
      title: input.taskTitle || "Human follow-up needed",
      description: input.aiSummary,
      priority: input.priority,
      status: "OPEN",
    },
  });
}

async function createBookingRequest(input: AiActionInput) {
  const existingBooking = await input.tx.booking.findFirst({
    where: {
      companyId: input.companyId,
      conversationId: input.conversationId,
    },
  });

  if (existingBooking) {
    return existingBooking;
  }

  return input.tx.booking.create({
    data: {
      companyId: input.companyId,
      conversationId: input.conversationId,
      customerId: input.customerId,
      title: buildBookingTitle(input.industry),
      dateTime: parseSimpleDateTime(input.text),
      status: "REQUESTED",
    },
  });
}

export async function runAiActions(
  input: AiActionInput
): Promise<AiActionResult> {
  let booking = null;
  let task = null;
  let bookingCreated = false;
  let actionSummary = input.nextAction;

  if (shouldCreateBooking(input)) {
    booking = await createBookingRequest(input);
    bookingCreated = true;

    task = await createOrReuseHumanTask({
      ...input,
      priority: input.priority === "LOW" ? "MEDIUM" : input.priority,
      taskTitle: `Confirm ${buildBookingTitle(input.industry).toLowerCase()}`,
      aiSummary: `${input.aiSummary}\n\nAI created a booking request. Staff should confirm availability before promising the customer.`,
    });

    actionSummary =
      "Booking request created. Staff should confirm availability and follow up with the customer.";

    await input.tx.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        bookingCreated: true,
        status: "FOLLOW_UP",
        nextAction: actionSummary,
        updatedAt: new Date(),
      },
    });

    return {
      bookingCreated,
      booking,
      task,
      actionSummary,
    };
  }

  if (input.humanNeeded) {
    task = await createOrReuseHumanTask(input);

    await input.tx.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: "HUMAN_REQUIRED",
        nextAction: input.nextAction,
        updatedAt: new Date(),
      },
    });

    return {
      bookingCreated: false,
      booking: null,
      task,
      actionSummary: input.nextAction,
    };
  }

  await input.tx.conversation.update({
    where: {
      id: input.conversationId,
    },
    data: {
      nextAction: input.nextAction,
      updatedAt: new Date(),
    },
  });

  return {
    bookingCreated: false,
    booking: null,
    task: null,
    actionSummary,
  };
}