/**
 * Lightweight in-process event bus for the voice engine.
 *
 * Directional step toward event-driven CRM integration — no Kafka/Redis/RabbitMQ.
 * CRM modules can subscribe without coupling into the Twilio/OpenAI hot path.
 */

export type VoiceEngineEventType =
  | "SpeechStarted"
  | "SpeechEnded"
  | "VadTriggered"
  | "TurnCommitted"
  | "AIResponseStarted"
  | "AIResponseCompleted"
  | "BargeIn"
  | "LeadUpdated"
  | "MeetingCreated"
  | "SummaryGenerated"
  | "CallEnded";

export type VoiceEngineEventPayload = {
  callSid?: string;
  conversationId?: string;
  companyId?: string;
  reason?: string;
  text?: string;
  phase?: string;
  [key: string]: unknown;
};

export type VoiceEngineEventHandler = (
  payload: VoiceEngineEventPayload,
) => void;

/**
 * Per-call event bus. Create one instance per Media Stream session.
 */
export class VoiceEventBus {
  private handlers = new Map<
    VoiceEngineEventType,
    Set<VoiceEngineEventHandler>
  >();

  on(type: VoiceEngineEventType, handler: VoiceEngineEventHandler) {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  off(type: VoiceEngineEventType, handler: VoiceEngineEventHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type: VoiceEngineEventType, payload: VoiceEngineEventPayload = {}) {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`VoiceEventBus handler error (${type}):`, error);
      }
    }
  }

  /**
   * Remove all listeners (call cleanup).
   */
  clear() {
    this.handlers.clear();
  }
}
