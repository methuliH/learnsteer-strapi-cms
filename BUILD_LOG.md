# Build Log

Every change made while building the Strapi CMS, newest at the bottom.

---

## 1. Project scaffold

**Before:** nothing; the old CMS is a separate Next.js + Drizzle app (`Sasnaka-Sansada/learnsteer-cms`) that talks to the shared LearnSteer database directly.

**Now**
- Strapi 5.60.0, TypeScript, npm, created with `create-strapi --ts --no-example --skip-cloud --dbclient=postgres`.
- Dedicated local Postgres 17 in Docker (`learnsteer-strapi-pg`, port 5434, database `learnsteer_strapi`). Ports 5432/5433 were already used by other local databases.
- `.env` (gitignored) holds generated secrets and the local DB settings. `.env.example` documents every variable, including the Neon settings and `PDF_MAX_MB`.

## 2. Content types

**Now:** Subject, Unit, Lesson, Quiz, Past Paper, Revision Module, plus components `lesson.note-section`, `lesson.resource`, `quiz.question`, `quiz.option`. Fields mirror the old Drizzle schema (`src/db/schema.ts` in the old repo), with these changes:
- `is_visible` -> Strapi Draft & Publish (Lesson, Quiz, Past Paper, Revision Module).
- Old `status` / `reviewer` / `review_notes` -> `reviewStatus` (draft, in_review, changes_requested, approved) + `reviewNotes`. Reviewer identity comes from Strapi's own updatedBy/publishedBy.
- PDF URLs (`file_url`, `paper_pdf_url`, ...) -> real Strapi media fields.
- Lesson notes and resources, and quiz questions/options, are components instead of separate tables.
- All tables prefixed `ls_` so they cannot collide with the shared LearnSteer tables.
- Not modelled: users, submissions, answers, user_lesson_progress, lesson_qa, sso_tickets, app_configs (student-side / Go backend data).

## 3. PDF-only uploads (`src/pdf-only.ts`)

**Now:** a document-service middleware checks every media id sent for the PDF fields (lesson resources, quiz marking scheme, past paper + marking scheme, revision module notes/guide). Rejects anything whose MIME type is not `application/pdf`, and anything over `PDF_MAX_MB` (default 50). Strapi's media field can only restrict to "files" in general, which is why this is code (as noted in the Notion log).

## 4. Approval workflow (`src/review-workflow.ts`)

**Now:** Lessons follow Author -> Editor review without Strapi Enterprise:
- only Editors / Super Admins can publish;
- only Editors / Super Admins can set `approved` or `changes_requested`;
- publishing requires `reviewStatus = approved`.
Calls without an admin user (scripts, imports) are not restricted.

## 5. Docker

**Now:** two-stage `Dockerfile` on `node:22-alpine` (build with dev deps, prune, run as the `node` user). `.dockerignore` excludes `.env*` (except `.env.example`), `node_modules`, build output and uploads. Secrets are passed at runtime only.

## 6. Verification

- `tsc --noEmit` clean (before and after Strapi generated its types).
- `npm run develop` starts in ~75 s; all `ls_*` and component tables created; `/_health` returns 204; `/admin` serves the first-admin registration page.
- `npm run verify:rules` (`scripts/verify-rules.js`): **11/11 passed**
  - PNG as lesson resource: rejected
  - PDF over 50 MB: rejected
  - PDF as lesson resource: accepted
  - PNG as past-paper marking scheme: rejected
  - Author sets in_review: allowed
  - Author sets approved: forbidden
  - Author publishes: forbidden
  - Editor publishes before approval: rejected
  - Editor approves: allowed
  - Editor publishes after approval: allowed
  - Published version exists afterwards: yes
- No admin account was created; the first administrator is left for the owner to register at `/admin`.
