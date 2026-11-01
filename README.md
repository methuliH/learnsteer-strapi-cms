# LearnSteer Strapi CMS

Content management for LearnSteer 2.0, rebuilt on **Strapi 5** (TypeScript) as decided in the LearnSteer CMS Dashboard plan: Strapi owns content, auth and roles; Go services handle heavy processing; Postgres on Neon; Docker for deployment.

This replaces the earlier Next.js + Drizzle CMS (`Sasnaka-Sansada/learnsteer-cms`). The Strapi admin panel at `/admin` is the CMS UI.

## What's in here

| Content type | Draft & Publish | Notes |
|---|---|---|
| Subject | no | name, code (unique), stream, medium, icon, color, order |
| Unit | no | belongs to a Subject |
| Lesson | yes | belongs to a Unit; rich-text `body`, note sections, **PDF resources**, `reviewStatus` + `reviewNotes` |
| Quiz | yes | questions (component) with options (component), marking scheme **PDF** |
| Past Paper | yes | paper + marking scheme **PDFs** |
| Revision Module | yes | short notes + essay guide **PDFs** |

All tables use an `ls_` prefix so Strapi can never collide with the existing LearnSteer tables (`lessons`, `subjects`, ...) used by the Go backend. Student data (users, submissions, progress, Q&A) stays with the Go backend and is deliberately not modelled here.

## Roles and the approval workflow

Uses Strapi's built-in admin roles (Community edition, no Enterprise "Review Workflows" needed):

| Old CMS role | Strapi role | Can do |
|---|---|---|
| Super Administrator | Super Admin | everything |
| Content Approver | Editor | approve / request changes, publish |
| Content Creator | Author | create and edit own drafts, submit for review |

Rules enforced in code (`src/review-workflow.ts`) for Lessons:
1. Only Editors and Super Admins can publish.
2. Only Editors and Super Admins can set Review status to `approved` or `changes_requested`.
3. A lesson can only be published once its Review status is `approved`.

Flow: Author writes a draft and sets Review status to `in_review` -> Editor reads it, either sets `changes_requested` with Review notes or sets `approved` and publishes.

## PDF-only uploads

`src/pdf-only.ts` rejects any non-PDF file (by MIME type) attached to: lesson resources, quiz marking schemes, past papers and marking schemes, revision module notes/guides. Max size is `PDF_MAX_MB` (default 50).

## Run it locally

Requirements: Node 20-24, Docker.

```bash
# 1. Database (dedicated to Strapi, port 5434)
docker run -d --name learnsteer-strapi-pg -e POSTGRES_USER=strapi -e POSTGRES_PASSWORD=strapi \
  -e POSTGRES_DB=learnsteer_strapi -v learnsteer-strapi-pgdata:/var/lib/postgresql/data \
  -p 127.0.0.1:5434:5432 --restart unless-stopped postgres:17

# 2. App
cp .env.example .env      # then replace every "tobemodified" secret
npm install
npm run develop           # admin panel: http://localhost:1337/admin
```

On first start, open `/admin` and create the first administrator (becomes Super Admin). Then invite team members under Settings -> Administration panel -> Users with the Author or Editor role.

### Check the rules

```bash
npm run verify:rules
```

Boots Strapi without the HTTP server, creates throwaway rows, checks the PDF and review rules as an Author and as an Editor, then deletes the rows. Expect `11/11 passed`.

## Deploy (Docker)

```bash
docker build -t learnsteer-strapi-cms .
docker run -p 1337:1337 --env-file .env.production learnsteer-strapi-cms
```

Secrets are runtime env vars only; `.env*` files are excluded from the image.

### Neon

Development currently uses the Neon project `learnsteer-strapi` (`lingering-feather-71878710`, Singapore) in the owner's Neon org; the connection string lives only in `.env`.


Use the **pooled** connection string with SSL, on a database/branch dedicated to Strapi:

```
DATABASE_URL=postgresql://...-pooler.<region>.aws.neon.tech/strapi?sslmode=require
DATABASE_SSL=true
```

Do **not** point Strapi at the shared LearnSteer production tables.

## Not done yet

- **How published content reaches students.** Pick one: (a) Strapi webhooks -> a Go service that writes to the existing LearnSteer tables, or (b) the Go backend reads Strapi's REST API with a scoped API token.
- **Import of existing content** (subjects, units, 62 lessons) from the current database.
- **Upload storage**: uploads go to `public/uploads` (local disk). Containers need an S3-compatible provider before going live.
- **Email**: still the default `sendmail` provider; switch to nodemailer/SMTP for invites and notifications.
- **Notifications** to Editors when a lesson is submitted for review.

See `BUILD_LOG.md` for every change made so far.
