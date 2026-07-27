import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");

function rotateSecret(name: string, current: string) {
  const next = randomBytes(48).toString("base64url");
  if (next === current) {
    throw new Error(`Generated duplicate value for ${name}`);
  }
  return next;
}

function main() {
  const raw = readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const keys = ["JWT_SECRET", "VOICE_WEBHOOK_SECRET"] as const;
  const values = new Map<string, string>();

  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    values.set(match[1], match[2].replace(/^"|"$/g, ""));
  }

  const rotated = new Set<string>();
  const updated = lines.map((line) => {
    for (const key of keys) {
      if (!line.startsWith(`${key}=`)) continue;
      const current = values.get(key) || "";
      const next = rotateSecret(key, current);
      rotated.add(key);
      return `${key}="${next}"`;
    }
    return line;
  });

  if (rotated.size !== keys.length) {
    throw new Error("Failed to rotate all required secrets");
  }

  const jwt = updated.find((line) => line.startsWith("JWT_SECRET=")) || "";
  const voice = updated.find((line) => line.startsWith("VOICE_WEBHOOK_SECRET=")) || "";
  if (jwt === voice) {
    throw new Error("Rotated secrets must differ");
  }

  writeFileSync(envPath, updated.join("\n"), "utf8");

  console.log(
    JSON.stringify({
      rotated: Array.from(rotated),
      oldValuesRemoved: true,
      valuesDiffer: true,
    }),
  );
}

main();
