import "dotenv/config";
import { reconcileCallLifecycle } from "../src/services/callReconciliation.service";

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const dryRun = !apply;
  let companyId: string | null = null;
  let staleActiveCallMinutes: number | undefined;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--company-id") {
      companyId = argv[i + 1] || null;
      i += 1;
    } else if (arg === "--stale-minutes") {
      staleActiveCallMinutes = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--limit") {
      limit = Number(argv[i + 1]);
      i += 1;
    }
  }

  return { apply, dryRun, companyId, staleActiveCallMinutes, limit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.apply) {
    console.log(
      JSON.stringify({
        scope: "call_reconcile",
        event: "starting_dry_run",
        hint: "Pass --apply to repair provably stale Task/Conversation/job rows.",
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        scope: "call_reconcile",
        event: "starting_apply",
        warning: "Will only repair terminal-Call mismatches; will not invent outcomes.",
      }),
    );
  }

  const report = await reconcileCallLifecycle({
    apply: args.apply,
    companyId: args.companyId,
    staleActiveCallMinutes: args.staleActiveCallMinutes,
    limit: args.limit,
  });

  console.log(JSON.stringify(report, null, 2));

  const repairable = report.findings.filter((f) => f.repairable).length;
  if (!args.apply && repairable > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      scope: "call_reconcile",
      event: "failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }),
  );
  process.exit(1);
});
