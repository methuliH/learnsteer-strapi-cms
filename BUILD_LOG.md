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

## 7. Connected to Neon

**Before:** Strapi ran against the local Docker Postgres (`learnsteer-strapi-pg`, port 5434).

**Now**
- New Neon project **`learnsteer-strapi`** (`lingering-feather-71878710`) in the owner's own Neon org, region `aws-ap-southeast-1` (Singapore, same region as LearnSteer), Postgres 18, database `strapi`, role `strapi_owner`.
- `.env` (gitignored): `DATABASE_URL` = the **pooled** connection string with `sslmode=require` (the `channel_binding` parameter removed), `DATABASE_SSL=true`. The old local `DATABASE_*` lines are kept as comments to switch back.
- Strapi created its schema on Neon: 61 tables, 15 of them `ls_*` content tables.

**Why its own project, not Seniru's `ss-learnsteer`:** a database on the `ss-learnsteer` production branch would share the live app's compute and connection limit, and it is a team project. Creating a database there was also blocked by the permission system as a change to a shared resource. Neon can transfer this project to the team org later.

**Checks**
- `/_health` 204, no server errors, admin panel loads.
- `npm run verify:rules` against Neon: **11/11 passed**.
- Seniru's `ss-learnsteer` `neondb` (production): 18 tables before and after; nothing created or changed there.

## 8. Imported existing content (subjects, units, lessons)

**Before:** Strapi on Neon was empty.

**Schema changes needed to fit the real data** (found by profiling the source first)
- `lesson.lessonType`: enumeration (Video/Reading/Live/Practical) -> free text. The real data uses 16 kinds such as "Worked Examples", "Video & Summary", "3D Visualization".
- `lesson.note-section.sectionType`: added `tip` and `phase` (the data uses text/tip/phase).
- `lesson.note-section.imageUrl` (new): all 70 note images are links on `cdn.learnsteer.lk`, not uploads.
- `lesson.resource`: `file` is now optional; new `externalUrl`, `fileType`, `fileSize`. All 60 resources are `cdn.learnsteer.lk` links (58 PDF, **2 DOCX**). The PDF-only check still applies to anything uploaded.
- `legacyId` (new) on Subject, Unit, Lesson: the old table id, used to make the import re-runnable and to map back to the old database later.

**Now**
- `scripts/import-legacy.js` (`npm run import:legacy`, needs `SOURCE_DATABASE_URL`, supports `--dry-run`). Reads the source inside a `READ ONLY` transaction; skips rows whose `legacyId` already exists.
- Source: the Neon `cms-dev` branch of `ss-learnsteer` (a copy of production; read-only access only).
- Imported into Strapi on Neon: **15 subjects, 30 units, 62 lessons** (all published, `reviewStatus = approved`, since all were visible), **70 note sections, 60 resources**.

**Checks**
- Dry run reported 15/30/62 to create before anything was written.
- Second real run: created 0, skipped 15/30/62 (re-runnable).
- All 30 units linked to a subject; all 62 published lessons linked to a unit.
- All 62 lessons compared with the source on id, title, type, video URL, duration, lesson number, instructor: **62 match, 0 differ**.
- `tsc` clean; `npm run verify:rules` still **11/11** after the schema changes.

**Not imported yet:** quizzes (12, with 459 questions and 1,800 options), past papers (56), revision modules (42). Note images and resource files are still links to `cdn.learnsteer.lk`, not files in Strapi's media library.

## 9. Imported quizzes, past papers and revision modules

**Before:** Strapi had subjects, units and lessons only (step 8).

**What profiling the source showed**
- Quizzes: 12 in the old database, but **6 are deleted** there (`is_deleted`; several are tests like "[TEST]"). Only the 6 live ones were imported.
- Questions keep their answer options in two places: the `options` table (with `is_correct`) and an older JSON `questions.options` column (ids a-e) with `correct_answer`. 99 questions only have the JSON form and **no correct answer recorded**; all 99 belong to the deleted quizzes.
- Most question/option image fields are empty strings (89 of 459 questions and 125 of 1,800 options have a real image).
- No quiz has a subject or unit, quiz marking schemes are empty, and no revision module has a unit. Past papers and revision modules have PDF links on `cdn.learnsteer.lk`.

**Schema changes**
- `legacyId` on Quiz, Past Paper, Revision Module.
- URL fields for CDN-hosted files: Quiz `markingSchemeUrl`; Past Paper `paperUrl`, `markingSchemeUrl`; Revision Module `shortNotesUrl`, `essayGuideUrl`; question and option `imageUrl`.
- `quiz.option`: new `label` (keeps the a-e id from the JSON form); `text` no longer required (allows image-only options).

**Import script** (`scripts/import-legacy.js`): now also imports quizzes (questions and options as components: options from the `options` table when present, otherwise from the JSON column), past papers and revision modules. Empty strings become empty values. It reports questions that came from JSON options or have no correct answer.

**Result:** created 6 quizzes (published), 56 past papers, 42 revision modules (published). Second run: created 0, skipped everything. Question warnings: 0 (every imported question has exactly one correct answer).

**Checks against the source (read-only)**
- Each of the 6 quizzes matches on question / option / correct-answer counts (299 questions, 1,495 options, 299 correct).
- Past papers 56/56 match on id, title, year, paper URL, marking scheme URL, model flag; all 56 linked to their subject.
- Revision modules 42/42 match on id, title, both PDF URLs, topic count; all 42 linked to their subject.
- `tsc` clean; `npm run verify:rules` 11/11.

**Not imported on purpose:** the 6 deleted quizzes, and student data (users, submissions, answers, progress, Q&A).
