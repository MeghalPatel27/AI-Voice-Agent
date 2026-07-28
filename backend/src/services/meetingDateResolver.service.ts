import { DateTime } from "luxon";

export type MeetingDateResolutionInput = {
  preferredTimeText: string;
  timezone: string;
  referenceInstant: Date;
  modelResolvedIso?: string | null;
};

export type MeetingDateResolutionResult =
  | {
      ok: true;
      localDate: string;
      localTime: string;
      timezone: string;
      utcTimestamp: string;
      dateTime: Date;
      originalPhrase: string;
    }
  | {
      ok: false;
      needsClarification: true;
      message: string;
      originalPhrase: string;
    };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function normalizePhrase(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function hasTimeSignal(text: string) {
  return /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i.test(text) ||
    /\b(\d{1,2}):(\d{2})\b/.test(text) ||
    /\b([01]?\d|2[0-3])\s?(am|pm)\b/i.test(text);
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const match =
    text.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i) ||
    text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function resolveRelativeDay(
  phrase: string,
  reference: DateTime,
): DateTime | null {
  const lower = phrase.toLowerCase();
  if (/\btoday\b/.test(lower)) return reference.startOf("day");
  if (/\btomorrow\b/.test(lower)) return reference.plus({ days: 1 }).startOf("day");

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const day = WEEKDAYS[i];
    if (!new RegExp(`\\b${day}\\b`, "i").test(lower)) continue;
    const targetWeekday = i;
    const currentWeekday = reference.weekday % 7;
    let delta = (targetWeekday - currentWeekday + 7) % 7;
    if (delta === 0 && !/\bthis\b/i.test(lower)) delta = 7;
    if (/\bnext\b/i.test(lower) && delta <= 6) {
      delta = delta === 0 ? 7 : delta + 7;
    }
    return reference.plus({ days: delta }).startOf("day");
  }
  return null;
}

function tryIsoHint(iso: string | null | undefined, zone: string): DateTime | null {
  if (!iso) return null;
  const parsed = DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
  if (!parsed.isValid) return null;
  return parsed;
}

export function resolveMeetingDateTime(
  input: MeetingDateResolutionInput,
): MeetingDateResolutionResult {
  const phrase = normalizePhrase(input.preferredTimeText);
  const zone = input.timezone.trim();
  if (!phrase) {
    return {
      ok: false,
      needsClarification: true,
      message: "Please provide when you would like to meet.",
      originalPhrase: phrase,
    };
  }

  const reference = DateTime.fromJSDate(input.referenceInstant, { zone });
  if (!reference.isValid) {
    return {
      ok: false,
      needsClarification: true,
      message: "The meeting timezone is invalid.",
      originalPhrase: phrase,
    };
  }

  if (!hasTimeSignal(phrase) && /\b(tomorrow|today|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(phrase)) {
    return {
      ok: false,
      needsClarification: true,
      message: "What time works for you on that day?",
      originalPhrase: phrase,
    };
  }

  const clock = parseClock(phrase);
  if (!clock) {
    return {
      ok: false,
      needsClarification: true,
      message: "Please provide a clear date and time.",
      originalPhrase: phrase,
    };
  }

  let local = resolveRelativeDay(phrase, reference);
  if (!local) {
    const hinted = tryIsoHint(input.modelResolvedIso, zone);
    if (hinted) {
      local = hinted.startOf("day");
    }
  }
  if (!local) {
    return {
      ok: false,
      needsClarification: true,
      message: "Please confirm the exact calendar date for the meeting.",
      originalPhrase: phrase,
    };
  }

  const resolved = local.set({
    hour: clock.hour,
    minute: clock.minute,
    second: 0,
    millisecond: 0,
  });

  if (!resolved.isValid) {
    return {
      ok: false,
      needsClarification: true,
      message: "That date and time could not be resolved.",
      originalPhrase: phrase,
    };
  }

  if (resolved <= reference.minus({ minutes: 5 })) {
    return {
      ok: false,
      needsClarification: true,
      message: "That time appears to be in the past. Please choose a future time.",
      originalPhrase: phrase,
    };
  }

  const hinted = tryIsoHint(input.modelResolvedIso, zone);
  if (hinted && Math.abs(hinted.toMillis() - resolved.toMillis()) > 36 * 60 * 60 * 1000) {
    return {
      ok: false,
      needsClarification: true,
      message: "Please confirm the exact calendar date and time with the caller.",
      originalPhrase: phrase,
    };
  }

  return {
    ok: true,
    localDate: resolved.toFormat("yyyy-MM-dd"),
    localTime: resolved.toFormat("h:mm a"),
    timezone: zone,
    utcTimestamp: resolved.toUTC().toISO() || resolved.toUTC().toISO()!,
    dateTime: resolved.toUTC().toJSDate(),
    originalPhrase: phrase,
  };
}
