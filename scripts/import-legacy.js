// Imports subjects, units and lessons (with note sections and resources) from
// the old LearnSteer database into Strapi.
//
//   SOURCE_DATABASE_URL=postgresql://...  node scripts/import-legacy.js [--dry-run]
//
// - The source is only read, inside a READ ONLY transaction.
// - Safe to re-run: rows are matched on legacyId (the old table id) and
//   anything already imported is skipped.
// - Visible lessons are imported as published with reviewStatus "approved";
//   hidden ones as drafts.
// - Note images and resource files stay as external URLs (imageUrl /
//   externalUrl) until upload storage (S3) is decided.
const path = require('path');
const { createRequire } = require('module');

const appDir = process.cwd();
const req = createRequire(path.join(appDir, 'package.json'));
const { Client } = req('pg');
const { createStrapi, compileStrapi } = req('@strapi/strapi');

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE = process.env.SOURCE_DATABASE_URL;
if (!SOURCE) {
  console.error('Set SOURCE_DATABASE_URL to the old LearnSteer database connection string.');
  process.exit(1);
}

async function readSource() {
  const client = new Client({ connectionString: SOURCE, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const q = async (text) => (await client.query(text)).rows;
    const data = {
      subjects: await q('select * from subjects order by order_index, id'),
      units: await q('select * from units order by subject_id, order_index, unit_number, id'),
      lessons: await q('select * from lessons order by unit_id, order_index, lesson_number, id'),
      notes: await q('select * from lesson_notes order by lesson_id, order_index, id'),
      resources: await q('select * from lesson_resources order by lesson_id, id'),
    };
    await client.query('COMMIT');
    return data;
  } finally {
    await client.end();
  }
}

const groupBy = (rows, key) =>
  rows.reduce((m, r) => (m.get(r[key]) ? m.get(r[key]).push(r) : m.set(r[key], [r]), m), new Map());

(async () => {
  const src = await readSource();
  console.log(
    `source: ${src.subjects.length} subjects, ${src.units.length} units, ${src.lessons.length} lessons, ` +
      `${src.notes.length} note sections, ${src.resources.length} resources`
  );

  const strapi = await createStrapi(await compileStrapi()).load();
  const S = strapi.documents('api::subject.subject');
  const U = strapi.documents('api::unit.unit');
  const L = strapi.documents('api::lesson.lesson');
  const stats = { created: { subjects: 0, units: 0, lessons: 0 }, skipped: { subjects: 0, units: 0, lessons: 0 } };

  try {
    const existing = async (docs, legacyId) =>
      (await docs.findFirst({ filters: { legacyId }, fields: ['documentId'] }))?.documentId;

    // Subjects
    const subjectDoc = new Map();
    for (const s of src.subjects) {
      let id = await existing(S, s.id);
      if (id) stats.skipped.subjects++;
      else {
        stats.created.subjects++;
        if (!DRY_RUN) {
          id = (
            await S.create({
              data: {
                legacyId: s.id, name: s.name, code: s.code, stream: s.stream, medium: s.medium,
                icon: s.icon, color: s.color, order: s.order_index ?? 0,
              },
            })
          ).documentId;
        }
      }
      subjectDoc.set(s.id, id);
    }

    // Units
    const unitDoc = new Map();
    for (const u of src.units) {
      let id = await existing(U, u.id);
      if (id) stats.skipped.units++;
      else {
        stats.created.units++;
        if (!DRY_RUN) {
          id = (
            await U.create({
              data: {
                legacyId: u.id, subject: subjectDoc.get(u.subject_id), unitNumber: u.unit_number,
                name: u.name, description: u.description, color: u.color, order: u.order_index ?? 0,
              },
            })
          ).documentId;
        }
      }
      unitDoc.set(u.id, id);
    }

    // Lessons (+ note sections and resources as components)
    const notesBy = groupBy(src.notes, 'lesson_id');
    const resBy = groupBy(src.resources, 'lesson_id');
    for (const l of src.lessons) {
      if (await existing(L, l.id)) {
        stats.skipped.lessons++;
        continue;
      }
      stats.created.lessons++;
      if (DRY_RUN) continue;
      const visible = l.is_visible !== false;
      await L.create({
        status: visible ? 'published' : 'draft',
        data: {
          legacyId: l.id,
          unit: unitDoc.get(l.unit_id),
          lessonNumber: l.lesson_number,
          title: l.title,
          instructor: l.instructor,
          videoUrl: l.video_url,
          durationMin: l.duration_min ?? 0,
          lessonType: l.lesson_type || 'Video',
          isLocked: l.is_locked ?? false,
          order: l.order_index ?? 0,
          summary: l.summary,
          targetDifficulty: ['Beginner', 'Intermediate', 'Advanced'].includes(l.target_difficulty)
            ? l.target_difficulty
            : 'Intermediate',
          tags: l.tags,
          reviewStatus: visible ? 'approved' : 'draft',
          reviewNotes: l.review_notes,
          notes: (notesBy.get(l.id) || []).map((n) => ({
            title: n.title,
            sectionType: ['text', 'tip', 'phase', 'html', 'image'].includes(n.section_type) ? n.section_type : 'text',
            content: n.content_markdown,
            imageUrl: n.image_url,
            order: n.order_index ?? 0,
          })),
          resources: (resBy.get(l.id) || []).map((r) => ({
            title: r.title,
            externalUrl: r.file_url,
            fileType: r.file_type || 'PDF',
            fileSize: r.file_size,
            color: r.color,
          })),
        },
      });
    }

    console.log(`${DRY_RUN ? 'DRY RUN, would create' : 'created'}:`, stats.created);
    console.log('already imported (skipped):', stats.skipped);
  } finally {
    await strapi.destroy();
  }
  process.exit(0);
})().catch((e) => {
  console.error('IMPORT FAILED:', e.message);
  process.exit(1);
});
