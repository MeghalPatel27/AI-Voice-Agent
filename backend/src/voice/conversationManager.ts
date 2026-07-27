/**
 * Lightweight conversation phase manager for Phase 2+.
 *
 * Prepares architecture for cleaner CRM extraction later.
 * Does NOT implement the full sales workflow — existing business
 * logic (meeting force, hangup, prompts) stays in the voice controller.
 */

export type ConversationPhase =
  | "greeting"
  | "discovery"
  | "requirements"
  | "confirmation"
  | "meeting"
  | "closing";

export type ConversationManagerHooks = {
  autoMeetingAfterCustomerTurns: number;
};

export type CallerTurnSummary = {
  transcript: string;
  customerTurnCount?: number;
  usefulRequirementCount?: number;
  meetingAlreadyCreated?: boolean;
};

const REQUIREMENT_HINTS =
  /\b(website|web\s*site|e-?commerce|store|chatbot|whatsapp|crm|automation|landing|seo|budget|price|pricing|timeline|feature)/i;

const CONFIRMATION_HINTS =
  /\b(yes|yeah|yep|correct|right|okay|ok|sure|that works|sounds good|confirm)/i;

const MEETING_HINTS =
  /\b(meeting|schedule|book|appointment|call\s*back|demo|consult)/i;

const CLOSING_HINTS =
  /\b(bye|goodbye|thanks|thank you|that's all|nothing else|hang\s*up)/i;

/**
 * Thin state manager: tracks conversational phase for future CRM hooks.
 * Business policies (auto-meeting threshold, hangup phrases) remain unchanged.
 */
export class ConversationManager {
  private phase: ConversationPhase = "greeting";
  private customerTurnCount = 0;
  private usefulRequirementCount = 0;
  private meetingCreated = false;

  constructor(private readonly hooks: ConversationManagerHooks) {}

  getPhase(): ConversationPhase {
    return this.phase;
  }

  getCustomerTurnCount() {
    return this.customerTurnCount;
  }

  getUsefulRequirementCount() {
    return this.usefulRequirementCount;
  }

  /**
   * Whether enough useful caller turns exist to force a meeting request.
   * Mirrors the existing AUTO_MEETING_AFTER_CUSTOMER_TURNS policy.
   */
  shouldForceMeeting(input: {
    usefulRequirementCount: number;
    meetingAlreadyCreated?: boolean;
  }) {
    if (input.meetingAlreadyCreated || this.meetingCreated) return false;
    return (
      input.usefulRequirementCount >= this.hooks.autoMeetingAfterCustomerTurns
    );
  }

  /**
   * Advance phase from caller transcript. Returns enriched summary.
   * Does not change CRM write behaviour — only phase bookkeeping.
   */
  onCallerTranscript(input: CallerTurnSummary): CallerTurnSummary {
    const transcript = String(input.transcript || "").trim();
    if (!transcript) return input;

    this.customerTurnCount += 1;

    if (REQUIREMENT_HINTS.test(transcript)) {
      this.usefulRequirementCount += 1;
    }

    this.advanceFromCaller(transcript, input.meetingAlreadyCreated);

    return {
      ...input,
      customerTurnCount: this.customerTurnCount,
      usefulRequirementCount:
        input.usefulRequirementCount ?? this.usefulRequirementCount,
      meetingAlreadyCreated:
        input.meetingAlreadyCreated || this.meetingCreated,
    };
  }

  onAssistantReply(text: string) {
    const cleaned = String(text || "").trim();
    if (!cleaned) return { text: cleaned, phase: this.phase };

    if (CLOSING_HINTS.test(cleaned) || /goodbye/i.test(cleaned)) {
      this.phase = "closing";
    } else if (this.phase === "greeting") {
      this.phase = "discovery";
    }

    return { text: cleaned, phase: this.phase };
  }

  onMeetingCreated() {
    this.meetingCreated = true;
    this.phase = "meeting";
  }

  onCallEnding() {
    this.phase = "closing";
  }

  private advanceFromCaller(
    transcript: string,
    meetingAlreadyCreated?: boolean,
  ) {
    if (meetingAlreadyCreated || this.meetingCreated) {
      this.phase = this.phase === "closing" ? "closing" : "meeting";
      return;
    }

    if (CLOSING_HINTS.test(transcript)) {
      this.phase = "closing";
      return;
    }

    if (MEETING_HINTS.test(transcript)) {
      this.phase = "confirmation";
      return;
    }

    if (CONFIRMATION_HINTS.test(transcript) && this.phase === "confirmation") {
      this.phase = "meeting";
      return;
    }

    if (REQUIREMENT_HINTS.test(transcript)) {
      this.phase =
        this.usefulRequirementCount >= 2 ? "requirements" : "discovery";
      return;
    }

    if (this.phase === "greeting") {
      this.phase = "discovery";
    }
  }
}
