# Missing Migration Forensics: `20260725010000_add_lead_buying_interest`

- Inspection timestamp: 2026-07-27
- Status: **EXACT MIGRATION NOT RECOVERED**
- Production deployment: **BLOCKED** until migration history is reconciled

## Summary

The shared Supabase development database records migration `20260725010000_add_lead_buying_interest` as applied, but the migration directory is absent from the repository. Exhaustive local recovery did not locate the original `migration.sql`. Candidate reconstructions based on live database introspection did **not** match the stored Prisma checksum.

## Locations Searched

| Location | Result |
|---|---|
| Working tree `backend/prisma/migrations/` | Missing |
| `git status` / current branch `main` | Not present |
| `git fetch --all --prune` | No remote branches with file |
| `git log --all --full-history -- backend/prisma/migrations/20260725010000_add_lead_buying_interest/migration.sql` | No commits |
| `git log --all -S"add_lead_buying_interest"` | No commits |
| `git log --all -S"buyingInterest"` | No commits |
| `git log --all -S"buying_interest"` | No commits |
| `git log --all -S"InterestTier"` | No commits |
| `git log --all -S"interestTier"` | No commits |
| `git stash list` | Empty |
| `git worktree list` | Single worktree only |
| `git branch -a` | `main`, `origin/main` only |
| `git fsck --no-reflogs --unreachable` | No dangling migration blobs |
| Filesystem search under `Software Company/` for `*20260725010000*` / `*lead_buying*` | No matches |
| Repository text search for migration-related symbols | No migration file content in repo |

## `_prisma_migrations` Metadata (safe fields only)

| Field | Value |
|---|---|
| `migration_name` | `20260725010000_add_lead_buying_interest` |
| `checksum` | `feaf128ccb5a8fab05124f7a7d36a4d34a1bca756ac146b0818ea8d9100a2d0b` |
| `started_at` | `2026-07-24T20:02:25.789Z` |
| `finished_at` | `2026-07-24T20:02:30.840Z` |
| `applied_steps_count` | `1` |
| `rolled_back_at` | `null` |

## Database Objects Apparently Introduced

### Enum

- `InterestTier`: `HOT`, `WARM`, `COLD`

### `Customer` columns

- `interestTier` (`InterestTier`, nullable)
- `interestScore` (`INTEGER`, nullable)
- `interestReasons` (`JSONB`, nullable)
- `interestConfidence` (`INTEGER`, nullable)
- `interestSource` (`TEXT`, nullable)
- `interestUpdatedAt` (`TIMESTAMP`, nullable)

### `Call` columns

- `interestTier` (`InterestTier`, nullable)
- `interestScore` (`INTEGER`, nullable)
- `interestReasons` (`JSONB`, nullable)
- `interestConfidence` (`INTEGER`, nullable)
- `interestSource` (`TEXT`, nullable)
- `interestAnalyzedAt` (`TIMESTAMP`, nullable)
- `interestVoiceAnalyzedAt` (`TIMESTAMP`, nullable)
- `voiceAffect` (`JSONB`, nullable)

### Indexes observed in live database

- `Customer_interestScore_idx` on `Customer(interestScore)`
- `Customer_interestTier_idx` on `Customer(interestTier)`
- `Call_interestTier_idx` on `Call(interestTier)`

## Prisma Schema Drift

Current `backend/prisma/schema.prisma` does **not** declare any of the interest-tier fields above. The repository migration immediately after the missing one is `20260725023000_add_call_post_analysis`, which introduces `CallPostAnalysis` and `CallIntentLevel` separately.

## Checksum Recovery Attempts

Reconstructed SQL candidates (including enum, columns, `voiceAffect`, and the three interest indexes) were hashed with SHA-256 using Prisma's content-checksum approach. None matched:

- `feaf128ccb5a8fab05124f7a7d36a4d34a1bca756ac146b0818ea8d9100a2d0b`

**Conclusion:** the exact original migration text remains unknown.

## Read-Only Schema Diff Notes

`prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource --script` indicates the live database still contains the interest-tier objects above that are absent from the current Prisma schema.

`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma` could not be executed without configuring `datasource.shadowDatabaseUrl` for migration-directory replay.

## Disposable Database Reproducibility

No local PostgreSQL server, Docker, or other disposable Postgres environment was available in this pass (`docker`, `psql`, and `initdb` were not present). Therefore full chronological `prisma migrate deploy` replay was **not verified** on an isolated empty database.

## Production Risk

1. Fresh environments created only from repository migrations will miss `InterestTier` and related columns/indexes while later migrations may still apply.
2. Environments cloned from the current Supabase database contain objects with no authoritative migration artifact in source control.
3. Prisma schema and live database are divergent for lead-interest fields.
4. Using `prisma migrate resolve` or fabricating a migration without checksum proof would falsify migration history.

## Proposed Recovery Strategy (do not execute without approval)

1. Recover the exact `migration.sql` from an off-repo backup (developer machine, CI artifact, Supabase migration export, or another branch not present locally).
2. If recovery succeeds, restore to `backend/prisma/migrations/20260725010000_add_lead_buying_interest/migration.sql`, verify SHA-256 checksum against `_prisma_migrations.checksum`, and align `schema.prisma`.
3. Replay all migrations on a disposable Postgres database with `npx prisma migrate deploy`.
4. If recovery fails permanently, plan a **new additive reconciliation migration** plus explicit schema/model updates under a controlled change window. Do **not** rewrite the existing `_prisma_migrations` row without the exact original file.

## Repository Migration Order (current)

1. `20260704103332_init`
2. `20260705105149_add_agent_instructions`
3. `20260705174759_add_webhook_secret`
4. `20260706153950_add_outbound_messages`
5. `20260723143000_expand_call_status`
6. **`20260725010000_add_lead_buying_interest` — MISSING FROM REPO, APPLIED IN DB**
7. `20260725023000_add_call_post_analysis`
8. `20260727160000_add_hume_evi_runtime`
