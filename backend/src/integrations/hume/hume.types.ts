export type HumeWebhookEventType = "chat_started" | "chat_ended" | "tool_call";

export type HumeTwilioMetadata = {
  call_sid?: string;
  from_number?: string;
  to_number?: string;
};

export type HumeWebhookPayload = {
  event_name: HumeWebhookEventType;
  chat_id: string;
  chat_group_id?: string | null;
  config_id?: string | null;
  caller_number?: string | null;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
  twilio_metadata?: HumeTwilioMetadata | null;
  tool_call_message?: {
    name?: string;
    parameters?: string;
    response_required?: boolean;
    tool_call_id?: string;
    tool_type?: "builtin" | "function";
  } | null;
  [key: string]: unknown;
};

export type HumeChatEvent = {
  id?: string;
  type?: string;
  role?: string;
  message?: {
    role?: "user" | "assistant" | "system";
    content?: string;
    timestamp?: number;
  };
  emotion_features?: unknown;
  timestamp?: number;
  [key: string]: unknown;
};
