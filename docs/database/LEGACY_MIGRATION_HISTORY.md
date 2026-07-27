# Legacy Migration History

- Recorded at: 2026-07-27
- Scope: pre-canonical baseline executable migrations removed from `backend/prisma/migrations/`

## Why These Migrations Were Retired

The connected Supabase development project contained only test records. Migration history was not canonical because migration `20260725010000_add_lead_buying_interest` was applied in the database but could not be recovered from source control or checksum-verified. The live database also contained `InterestTier` drift absent from the current Prisma schema.

The user explicitly authorized wiping the development database and replacing executable migration history with one canonical baseline migration.

Git history remains the historical source for the retired migration files.

## Retired Migration Files And Checksums

| Migration | SHA-256 |
|---|---|
| `20260704103332_init` | `d5e38de20045f78752f78234079aba888c2f6fbe012b45ddec1bac541d9de450` |
| `20260705105149_add_agent_instructions` | `6c3079c734bb10b42d381b78eee49c4add8490f2c7865949e9ed19e47e2494a7` |
| `20260705174759_add_webhook_secret` | `81fc4ca66797e0413e7c7c7571ea4a59745bca517af33c9a2b258567c23b3465` |
| `20260706153950_add_outbound_messages` | `6e5d6835d4903ad03c97034f52d2547155591b6a802c2e63dc64ab58d1e45ec0` |
| `20260723143000_expand_call_status` | `7d1e00e0ea7b5680b1d5ed0d305a0780c2818a04ee6aa21c0f6f13be0e3b9e95` |
| `20260725023000_add_call_post_analysis` | `131e9cebe1be1aa8bda0a14992b85229b4b04fcd2d71baefb3dae4dc489191d4` |
| `20260727160000_add_hume_evi_runtime` | `60ecbccceca9372d78f9e20f9c1110fa803a3665ed88b5d7ff47fc6026149945` |

## Database-Only Migration Not Present In Repository

| Migration | SHA-256 stored in `_prisma_migrations` |
|---|---|
| `20260725010000_add_lead_buying_interest` | `feaf128ccb5a8fab05124f7a7d36a4d34a1bca756ac146b0818ea8d9100a2d0b` |

This migration introduced `InterestTier`, interest columns on `Customer` and `Call`, and `voiceAffect`. It was **not** recreated in the canonical baseline.

## Canonical Replacement

- New baseline migration: `20260727120000_canonical_product_baseline`
- Generated with: `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
- Applied via authorized `npx prisma migrate reset --force` on development project `tqmwrmlswbwngblxkibm`
