export type ScheduledCallDialInput = {
  phone: string;
  fromNumber: string;
  answerUrl: string;
  statusCallbackUrl: string;
  accountSid: string;
  authToken: string;
};

export type ScheduledCallDialResult =
  | { ok: true; callSid: string; initialStatus: string }
  | { ok: false; error: string };

export type ScheduledCallDialAdapter = {
  dial: (input: ScheduledCallDialInput) => Promise<ScheduledCallDialResult>;
};

function buildTwilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

export const twilioScheduledCallDialAdapter: ScheduledCallDialAdapter = {
  async dial(input) {
    const body = new URLSearchParams({
      To: input.phone,
      From: input.fromNumber,
      Url: input.answerUrl,
      Method: "POST",
      StatusCallback: input.statusCallbackUrl,
      StatusCallbackMethod: "POST",
    });

    body.append("StatusCallbackEvent", "initiated");
    body.append("StatusCallbackEvent", "ringing");
    body.append("StatusCallbackEvent", "answered");
    body.append("StatusCallbackEvent", "completed");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: buildTwilioAuthHeader(input.accountSid, input.authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    const json = (await response.json()) as { sid?: string; status?: string; message?: string };
    if (!response.ok) {
      return {
        ok: false,
        error: json?.message || "Twilio outbound call failed.",
      };
    }

    return {
      ok: true,
      callSid: String(json.sid || ""),
      initialStatus: String(json.status || "queued").toLowerCase(),
    };
  },
};

export const noDialScheduledCallAdapter: ScheduledCallDialAdapter = {
  async dial() {
    return {
      ok: false,
      error: "NO_DIAL_ADAPTER_ACTIVE",
    };
  },
};
