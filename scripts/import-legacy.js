// Imports subjects, units, lessons (with note sections and resources), quizzes
// (with questions and options), past papers and revision modules from the old
// LearnSteer database into Strapi.
//
//   SOURCE_DATABASE_URL=postgresql://...  node scripts/import-legacy.js [--dry-run]
//
// - The source is only read, inside a READ ONLY transaction.
// - Safe to re-run: rows are matched on legacyId (the old table id) and
//   anything already imported is skipped.
// - Visible lessons are imported as published with reviewStatus "approved";
//   hidden ones as drafts.
// - Note images, resource files and PDF links stay as external URLs
//   (imageUrl / externalUrl / *Url fields) until upload storage (S3) is decided.
// - Quizzes deleted in the old CMS are skipped.
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
      // Quizzes deleted in the old CMS (is_deleted / deleted_at) are not imported.
      quizzes: await q(
        'select * from quizzes where not coalesce(is_deleted, false) and deleted_at is null order by id'
      ),
      questions: await q('select * from questions order by quiz_id, order_index, id'),
      options: await q('select * from options order by question_id, id'),
      pastPapers: await q('select * from past_papers order by subject_id, year, id'),
      revisionModules: await q('select * from revision_modules order by subject_id, id'),
    };
    await client.query('COMMIT');
    return data;
  } finally {
    await client.end();
  }
}

const groupBy = (rows, key) =>
  rows.reduce((m, r) => (m.get(r[key]) ? m.get(r[key]).push(r) : m.set(r[key], [r]), m), new Map());

// The old data stores many "no value" fields as empty strings.
const blank = (v) => (v === '' || v === undefined ? null : v);

(async () => {
  const src = await readSource();
  console.log(
    `source: ${src.subjects.length} subjects, ${src.units.length} units, ${src.lessons.length} lessons, ` +
      `${src.notes.length} note sections, ${src.resources.length} resources, ` +
      `${src.quizzes.length} live quizzes, ${src.pastPapers.length} past papers, ` +
      `${src.revisionModules.length} revision modules`
  );

  const strapi = await createStrapi(await compileStrapi()).load();
  const S = strapi.documents('api::subject.subject');
  const U = strapi.documents('api::unit.unit');
  const L = strapi.documents('api::lesson.lesson');
  const Q = strapi.documents('api::quiz.quiz');
  const P = strapi.documents('api::past-paper.past-paper');
  const R = strapi.documents('api::revision-module.revision-module');
  const kinds = ['subjects', 'units', 'lessons', 'quizzes', 'pastPapers', 'revisionModules'];
  const stats = {
    created: Object.fromEntries(kinds.map((k) => [k, 0])),
    skipped: Object.fromEntries(kinds.map((k) => [k, 0])),
  };
  const warnings = { questionsWithoutCorrectAnswer: 0, questionsFromJsonOptions: 0 };

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

    // Quizzes (+ questions and options as components). Options come from the
    // `options` table when it has rows for the question; otherwise from the
    // older JSON `questions.options` column, which has no correct-answer flag.
    const optsBy = groupBy(src.options, 'question_id');
    const questionsBy = groupBy(src.questions, 'quiz_id');
    for (const z of src.quizzes) {
      if (await existing(Q, z.id)) {
        stats.skipped.quizzes++;
        continue;
      }
      stats.created.quizzes++;
      const questions = (questionsBy.get(z.id) || []).map((qn) => {
        const tableOpts = optsBy.get(qn.id) || [];
        let options;
        if (tableOpts.length) {
          options = tableOpts.map((o) => ({
            text: o.text, imageUrl: blank(o.image_url), isCorrect: o.is_correct === true,
          }));
        } else {
          warnings.questionsFromJsonOptions++;
          const json = Array.isArray(qn.options) ? qn.options : [];
          options = json.map((o) => ({
            label: o.id, text: o.text_markdown ?? o.text ?? '', imageUrl: blank(o.image_url),
            isCorrect: blank(qn.correct_answer) !== null && o.id === qn.correct_answer,
          }));
        }
        if (!options.some((o) => o.isCorrect)) warnings.questionsWithoutCorrectAnswer++;
        return {
          type: ['mcq', 'essay', 'short_answer'].includes(qn.type) ? qn.type : 'mcq',
          text: qn.text_markdown,
          imageUrl: blank(qn.image_url),
          explanation: blank(qn.explanation),
          unitName: blank(qn.unit_name),
          points: Number(qn.points ?? 1),
          order: Number(qn.order_index ?? 0),
          options,
        };
      });
      if (DRY_RUN) continue;
      await Q.create({
        status: z.is_visible ? 'published' : 'draft',
        data: {
          legacyId: Number(z.id),
          title: z.title,
          description: blank(z.description),
          medium: ['Sinhala', 'English', 'Tamil'].includes(z.medium) ? z.medium : 'Sinhala',
          streams: z.stream,
          isMock: z.is_mock === true,
          sessionNumber: Number(z.session_number ?? 1),
          durationMin: Number(z.duration_min ?? 0),
          releaseDate: z.release_date,
          endDate: z.end_date,
          markingSchemeUrl: blank(z.marking_scheme_url),
          questions,
        },
      });
    }

    // Past papers
    for (const p of src.pastPapers) {
      if (await existing(P, p.id)) {
        stats.skipped.pastPapers++;
        continue;
      }
      stats.created.pastPapers++;
      if (DRY_RUN) continue;
      await P.create({
        status: 'published',
        data: {
          legacyId: Number(p.id), subject: subjectDoc.get(p.subject_id), year: Number(p.year),
          title: p.title, badge: blank(p.badge) ?? 'A/L PAST PAPER', isModel: p.is_model === true,
          durationMin: Number(p.duration_min ?? 180), structure: blank(p.structure) ?? 'MCQ & Essay',
          paperUrl: blank(p.paper_pdf_url), markingSchemeUrl: blank(p.marking_scheme_url),
        },
      });
    }

    // Revision modules
    for (const m of src.revisionModules) {
      if (await existing(R, m.id)) {
        stats.skipped.revisionModules++;
        continue;
      }
      stats.created.revisionModules++;
      if (DRY_RUN) continue;
      await R.create({
        status: 'published',
        data: {
          legacyId: Number(m.id), subject: subjectDoc.get(m.subject_id),
          unit: m.unit_id ? unitDoc.get(m.unit_id) : null, title: m.title,
          topicsCount: Number(m.topics_count ?? 0), isPopular: m.is_popular === true,
          shortNotesUrl: blank(m.short_notes_pdf_url), essayGuideUrl: blank(m.essay_guide_pdf_url),
        },
      });
    }

    console.log(`${DRY_RUN ? 'DRY RUN, would create' : 'created'}:`, stats.created);
    console.log('already imported (skipped):', stats.skipped);
    console.log('question warnings (new quizzes only):', warnings);
  } finally {
    await strapi.destroy();
  }
  process.exit(0);
})().catch((e) => {
  console.error('IMPORT FAILED:', e.message);
  process.exit(1);
});
