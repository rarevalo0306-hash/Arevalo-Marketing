# MATYA privacy and review readiness — 12 October 2026

Audited production SHA: 9e191ac89d2120ee803b73aeccc9b7a162791b99. Operator supplied by owner: Orbusiness AI LLC; contact info@jokma.app. This PR is not a production release. Its exact branch is excluded from automatic Vercel deployments in vercel.json.

## Changes in this PR

Business deletion revokes stored Google refresh tokens, recursively removes only `<businessId>/` objects in Supabase Storage and `library/<businessId>/` objects in R2, then deletes relational records by cascade. Original Drive files and already-published external posts are untouched. Provider failures leave relational rows for a retry; some tokens/files may already have been removed, so the retry must be idempotent. Local-only storage deletion is blocked rather than falsely reporting completion. Missing R2 configuration blocks erasure when library records exist. Historical files outside those managed prefixes require manual reconciliation.

Google disconnect actions revoke the selected connection's refresh token, then delete that connection's data and what Matya derived from it (`purgeGoogleChannelData` in `src/lib/data-deletion.ts`): Search Console deletes `gsc`, `decay` and `cannibal` reports, its plan tasks and keyword proposals, and scrubs Search Console keywords from on-page and SEO setup reports; Analytics deletes `ga4` reports and `ga4:*` plan tasks; YouTube deletes its `PostMetric` rows and channel proposals; Business Profile removes the "posted from Matya" reply markers (public DataForSEO `gbp`/`reviews` data stays). Owner-approved results (tracked keywords, articles, rank fixes) and aggregated daily summaries are kept. Google revocation may invalidate other integrations under the same grant, and the connections notice explains possible reconnection. For complete business erasure use the business deletion workflow.

Retention (`src/lib/google-data.ts`, run by `/api/cron`): each Google connection is probed about once a day by refreshing its token. Only `invalid_grant` marks access as removed; three days later the connection and its data are purged with the same routine (`GOOGLE_REVOKED_PURGE=off` pauses this purge). YouTube results are deleted after 28 days and an unrefreshed channel name after 30. `gsc`/`ga4` reports keep the newest 2/3 per business and anything younger than 45/35 days. Prunes run during the 13:00 UTC cron hour.

Login and Connections expose privacy and data-deletion links before authorizing providers. Deletion operations check the authenticated session on the server.

## Confirmed deployment facts

- Google scopes: business.manage, webmasters.readonly, analytics.readonly, youtube.upload, youtube.readonly. Drive uses a shared-folder service account with drive.readonly.
- Meta page scopes: pages_show_list, pages_read_engagement, pages_manage_posts, business_management, instagram_basic, instagram_content_publish. Ads have a separate flow. No META_CONFIG_ID or META_ADS_CONFIG_ID environment names found in production, so the scope arrays are the configured path.
- Connection credentials encrypted by AES-256-GCM. App uses one shared password, not tenant users.
- Supabase region ca-central-1; media bucket is public, including documents stored there. R2 uses public delivery URLs.
- Configured production providers: Gemini, OpenAI, fal.ai, Recraft, Ideogram, DataForSEO, Brevo, Supabase, Cloudflare R2, Google and Meta. A configured key does not prove actual usage. No Anthropic key found in production metadata.
- Drive photos and brand manuals may enter Gemini prompts. Analytics visit totals and proposal evidence may enter Gemini prompts. No application model-training function found, but provider no-training terms must be verified against the actual key/project and service tier.
- Google Auth branding was in Testing with homepage/privacy/terms fields empty. Console scopes omitted webmasters.readonly although code requests it. Authorized domains include matya.app and older entries. Do not remove domains until clients are audited.
- Meta app was Unpublished, display name Arevalo Marketing, with privacy/terms/deletion URLs empty. Data-deletion mode is Instructions URL, not Callback.

## Remaining gates before external review

1. Review and deploy this PR only after owner authorization. Verify actual provider cleanup in an isolated disposable environment, not production business records.
2. Provide explicit YouTube visibility selection (currently upload metadata hardcodes public). Token-validity checks and retention are implemented (see above); confirm the Google OAuth app is in Production first, because Testing-mode tokens expire after 7 days and would trigger the revoked-access purge.
3. Confirm Gemini API key's paid-service project, no-training terms for Google API data at every processor, and prominent user consent for those transfers. Never send Google user data to unpaid/training-enabled services.
4. Confirm backup retention and deletion from storage/provider caches; define a monitored email request process. If restoring backups, reapply completed erasure requests.
5. Reconcile public branding (Meta still Arevalo Marketing), verify domain ownership in Search Console, declare only used scopes, and prepare review demonstrations and reviewer access. Scope declaration is not approval.
6. Final legal operator location/jurisdiction and policy acceptance remain owner decisions. Public legal pages must continue to describe deployed behavior, not this unmerged PR.

## Operator erasure procedure

Receive request at info@jokma.app; verify business owner without requesting tokens/passwords; identify exact business and scope; pause its campaigns and scheduled publishing; inventory owned files before removing rows; revoke provider access; remove only owned prefixes and report records; confirm no residual objects; record a minimal completion entry without copying deleted data. Treat external published content separately and identify backup/caching exceptions to the requester. YouTube requirements include user-requested deletion within 7 calendar days; do not enable public YouTube until the lifecycle supports this.

Validation uses mocked provider calls and synthetic businesses. No production records, files or tokens were deleted/revoked.
