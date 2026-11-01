# LearnSteer Strapi CMS

Content management for **LearnSteer 2.0**, rebuilt on **Strapi 5** (TypeScript, PostgreSQL on Neon, Docker), following the LearnSteer CMS Dashboard plan: Strapi owns content, roles and the editorial workflow; Go services stay responsible for the student platform and heavy processing.

It replaces the earlier Next.js + Drizzle CMS (`Sasnaka-Sansada/learnsteer-cms`). Staff use the Strapi admin panel at `/admin` as the CMS.

## Where it fits

```
STAFF SIDE (this repo)                     STUDENT SIDE (existing)
┌───────────────────────────────┐          ┌─────────────────────────────────┐
│ Strapi admin panel            │          │ learnsteer-frontend (React)     │
│ write -> review -> publish    │  bridge  │              │                  │
│                               │ ───────► │ learnsteer-backend (Go)         │
│ Neon: learnsteer-strapi (own) │  (TBD)   │ Neon: ss-learnsteer / neondb    │
└───────────────────────────────┘          └─────────────────────────────────┘
```

The CMS has its **own database**; it does not read or write the student platform's tables. How published content reaches students is still open (see [Open decisions](#open-decisions)).

## Features

- **Content model** mirroring the existing LearnSteer data: Subject, Unit, Lesson, Quiz, Past Paper, Revision Module.
- **Editorial workflow** (no Strapi Enterprise needed): Authors write and submit, Editors approve and publish.
- **PDF-only uploads** with a size limit, on every PDF field.
- **All existing content migrated** from the current database and checked against it.
- **REST API** for other services, protected by API tokens.
- **Docker image** tested in production mode.

## Content model

| Content type | Draft & Publish | Fields (main) |
|---|---|---|
| Subject | no | name, code (unique), stream, medium, icon, color, order |
| Unit | no | subject, unitNumber, name, description, color, order |
| Lesson | yes | unit, lessonNumber, title, instructor, videoUrl, durationMin, lessonType, body (rich text), note sections, resources, reviewStatus, reviewNotes |
| Quiz | yes | title, medium, streams, isMock, session, duration, release/end dates, questions -> options |
| Past Paper | yes | subject, year, title, isModel, duration, structure, paper + marking scheme |
| Revision Module | yes | subject, unit, title, topicsCount, short notes + essay guide |

- Tables are prefixed `ls_` so they can never clash with the student platform's tables (`lessons`, `subjects`, ...).
- `legacyId` on every type stores the id from the old database, so imports are re-runnable and content can be mapped back.
- Files from the old system are kept as links (`externalUrl`, `paperUrl`, `imageUrl`, ...) to `cdn.learnsteer.lk` until upload storage is decided.
- Student data (users, submissions, answers, progress, Q&A) is intentionally **not** in the CMS.

## Roles and workflow

| Old CMS role | Strapi admin role | Can |
|---|---|---|
| Super Administrator | Super Admin | everything |
| Content Approver | Editor | approve, request changes, publish |
| Content Creator | Author | create and edit own drafts, submit for review |

Rules enforced in `src/review-workflow.ts` (on top of role permissions):

1. Only Editors / Super Admins can publish lessons.
2. Only Editors / Super Admins can set Review status to `approved` or `changes_requested`.
3. A lesson can only be published once its Review status is `approved`.

Flow: Author saves a draft -> sets Review status to `in_review` -> Editor either requests changes (with Review notes) or approves and publishes.

## PDF uploads

`src/pdf-only.ts` rejects any non-PDF (by MIME type) and anything over `PDF_MAX_MB` (default 50) attached to lesson resources, quiz marking schemes, past papers and revision modules. Uploaded PDFs are stored as-is; there is no PDF processing yet.

## Migrated content

Imported with `scripts/import-legacy.js` (read-only on the source, re-runnable) and verified against the source database:

| | Imported |
|---|---|
| Subjects / Units | 15 / 30 |
| Lessons | 62, with 70 note sections and 60 resources |
| Quizzes | 6 live quizzes, 299 questions, 1,495 options (one correct answer each) |
| Past papers | 56 |
| Revision modules | 42 |

Quizzes deleted in the old CMS (6, including test quizzes) were not imported.

## Getting started

Requirements: Node 20-24, and either Docker (local Postgres) or a Neon database.

```bash
git clone https://github.com/methuliH/learnsteer-strapi-cms.git
cd learnsteer-strapi-cms
npm install
cp .env.example .env    # replace every "tobemodified" secret, set the database
npm run develop         # http://localhost:1337/admin
```

Local Postgres (optional):

```bash
docker run -d --name learnsteer-strapi-pg -e POSTGRES_USER=strapi -e POSTGRES_PASSWORD=strapi \
  -e POSTGRES_DB=learnsteer_strapi -p 127.0.0.1:5434:5432 postgres:17
```

On first start, open `/admin` and register the first administrator (becomes Super Admin), then invite the team under **Settings -> Administration panel -> Users** as Author or Editor.

### Neon

Use the **pooled** connection string with SSL, on a database dedicated to Strapi (never the student platform's tables):

```
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/strapi?sslmode=require
DATABASE_SSL=true
```

## Scripts

| Command | What it does |
|---|---|
| `npm run develop` | Dev server with auto-reload and admin panel |
| `npm run build` / `npm run start` | Production build / start |
| `npm run verify:rules` | Boots Strapi without HTTP, checks the PDF and workflow rules as an Author and an Editor (expects `11/11 passed`), cleans up after itself |
| `npm run import:legacy` | Imports content from the old database. Needs `SOURCE_DATABASE_URL`; supports `--dry-run` |

## API

Content is available over Strapi's REST API at `/api/...` (for example `/api/lessons?populate[notes]=true&populate[resources]=true`). Public access is off; create an API token under **Settings -> API Tokens** (read-only for consumers such as the Go backend).

## Deployment

```bash
docker build -t learnsteer-strapi-cms .
docker run -p 1337:1337 --env-file .env.production learnsteer-strapi-cms
```

Secrets are runtime environment variables only; `.env*` files are excluded from the image. Strapi needs a long-running server (Render, Railway, Fly.io, a VPS, Strapi Cloud), not a serverless platform such as Vercel.

## Project structure

```
src/
  api/                 content types (schema.json) + controllers/routes/services
  components/          lesson note sections & resources, quiz questions & options
  pdf-only.ts          PDF type/size validation
  review-workflow.ts   Author -> Editor rules
  index.ts             registers both rules
scripts/
  import-legacy.js     migration from the old database
  verify-rules.js      rule checks
config/                Strapi config (database, server, admin, plugins)
Dockerfile             two-stage production image
```

## Open decisions

1. **Bridge to the student platform**: (a) the Go backend reads this API, or (b) a sync service writes published content into the existing tables so the Go backend is unchanged.
2. **Hosting** for Strapi (e.g. Render, Singapore region).
3. **Upload storage** (S3-compatible, e.g. Cloudflare R2), and whether to move files from `cdn.learnsteer.lk` into the media library.
4. **Email provider** (SMTP) for invites and password resets.
5. **PDF processing** needed, if any (thumbnails, compression, text extraction, watermarking).

## Change history

See [`BUILD_LOG.md`](BUILD_LOG.md) for every change, with what was checked at each step.
