type Channel = "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type ReplyInput = {
  companyName: string;
  text: string;
  channel: Channel;
  intent: string;
  priority: Priority;
  humanNeeded: boolean;
  businessHours?: string | null;
  aiTone?: string | null;
  agentName?: string | null;
  agentInstructions?: string | null;
  nextAction?: string | null;
};

function getBusinessHoursLine(businessHours?: string | null) {
  if (!businessHours) return "";
  return ` Our business hours are ${businessHours}.`;
}

function tonePrefix(aiTone?: string | null) {
  if (!aiTone) return "";

  const tone = aiTone.toLowerCase();

  if (tone.includes("friendly")) return "Thanks for messaging. ";
  if (tone.includes("premium")) return "Thank you for reaching out. ";
  if (tone.includes("calm")) return "I understand. ";

  return "";
}

export function generateAiReply(input: ReplyInput) {
  const companyName = input.companyName || "the business";
  const businessHoursLine = getBusinessHoursLine(input.businessHours);
  const prefix = tonePrefix(input.aiTone);

  if (input.intent === "urgent_medical_case") {
    return `${prefix}This sounds urgent, so I have marked it for immediate staff attention at ${companyName}. Please contact emergency medical services or visit the nearest emergency facility if the situation is serious.`;
  }

  if (input.intent === "urgent_case") {
    return `${prefix}I have marked this as urgent and alerted the team at ${companyName}. A staff member should review this as soon as possible.`;
  }

  if (input.intent === "customer_complaint") {
    return `${prefix}I am sorry about this experience. I have shared this with the team at ${companyName} and marked it for human review so someone can help you properly.`;
  }

  if (input.intent === "callback_request") {
    return `${prefix}Sure, I have noted your callback request. A team member from ${companyName} will contact you soon.${businessHoursLine}`;
  }

  if (input.intent === "booking_request") {
    return `${prefix}Sure, I can help with that. Please share your preferred date, time, full name and any important details so ${companyName} can check availability.${businessHoursLine}`;
  }

  if (input.intent === "pricing_enquiry") {
    return `${prefix}I can help with pricing. Please share what exactly you need, quantity or service type, and any preferred date/time so ${companyName} can guide you with the right charges or package.`;
  }

  if (input.intent === "conversion_signal") {
    return `${prefix}Great. I have noted your confirmation. Please share any final details needed, and ${companyName} will move this to the next step.`;
  }

  if (input.intent === "lead_lost_or_not_interested") {
    return `${prefix}Understood. I have noted that. If you need anything later, you can message ${companyName} anytime.`;
  }

  if (input.channel === "AI_CALL") {
    return `${prefix}Thank you for the call. I have saved the details for ${companyName}. If anything needs staff attention, the team will follow up.`;
  }

  return `${prefix}Thanks for reaching out to ${companyName}. I have received your message. Could you please share a little more detail so I can help with the right next step?`;
}