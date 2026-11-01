// Boots the Strapi app (no HTTP server) and exercises the PDF-only and
// review-workflow rules. Creates its own test rows and deletes them after.
const { createRequire } = require('module');
const path = require('path');
const appDir = process.argv[2] || process.cwd();
const req = createRequire(path.join(appDir, 'package.json'));
process.chdir(appDir);
const { createStrapi, compileStrapi } = req('@strapi/strapi');

const results = [];
const check = async (name, expect, fn) => {
  try {
    await fn();
    results.push([expect === 'ok' ? 'PASS' : 'FAIL', name, 'succeeded']);
  } catch (e) {
    const msg = `${e.name}: ${e.message}`;
    results.push([expect === 'ok' ? 'FAIL' : 'PASS', name, msg]);
  }
};

(async () => {
  const ctx = await compileStrapi();
  const strapi = await createStrapi(ctx).load();
  const as = (code, fn) => strapi.requestContext.run({ state: { user: { roles: [{ code }] } } }, fn);
  const L = strapi.documents('api::lesson.lesson');
  const files = strapi.db.query('plugin::upload.file');
  const created = { subject: null, unit: null, lessons: [], files: [] };

  try {
    const mk = (name, mime, sizeKb) =>
      files.create({ data: { name, mime, size: sizeKb, url: `/uploads/${name}`, hash: `verify_${name}_${Date.now()}`, ext: path.extname(name), provider: 'local' } });
    const png = await mk('verify-image.png', 'image/png', 12); created.files.push(png.id);
    const pdf = await mk('verify-notes.pdf', 'application/pdf', 300); created.files.push(pdf.id);
    const bigPdf = await mk('verify-huge.pdf', 'application/pdf', 60 * 1024); created.files.push(bigPdf.id);

    const subject = await strapi.documents('api::subject.subject').create({ data: { name: 'Verify Subject', code: `VERIFY-${Date.now()}`, stream: 'Physical Science' } });
    created.subject = subject.documentId;
    const unit = await strapi.documents('api::unit.unit').create({ data: { name: 'Verify Unit', unitNumber: 1, subject: subject.documentId } });
    created.unit = unit.documentId;

    const base = { title: 'Verify lesson', lessonNumber: 1, unit: unit.documentId };

    // PDF-only
    await check('PNG attached as lesson resource is rejected', 'error', async () => {
      const l = await L.create({ data: { ...base, resources: [{ title: 'img', file: png.id }] } });
      created.lessons.push(l.documentId);
    });
    await check('PDF over PDF_MAX_MB is rejected', 'error', async () => {
      const l = await L.create({ data: { ...base, resources: [{ title: 'big', file: bigPdf.id }] } });
      created.lessons.push(l.documentId);
    });
    let lesson;
    await check('PDF attached as lesson resource is accepted', 'ok', async () => {
      lesson = await L.create({ data: { ...base, resources: [{ title: 'notes', file: pdf.id }] } });
      created.lessons.push(lesson.documentId);
    });
    await check('PNG as past-paper marking scheme is rejected', 'error', async () => {
      const p = await strapi.documents('api::past-paper.past-paper').create({ data: { title: 'x', year: 2020, markingScheme: png.id } });
      await strapi.documents('api::past-paper.past-paper').delete({ documentId: p.documentId });
    });

    // Review workflow
    const id = lesson.documentId;
    await check('Author can submit for review (in_review)', 'ok', () =>
      as('strapi-author', () => L.update({ documentId: id, data: { reviewStatus: 'in_review' } })));
    await check('Author cannot set approved', 'error', () =>
      as('strapi-author', () => L.update({ documentId: id, data: { reviewStatus: 'approved' } })));
    await check('Author cannot publish', 'error', () =>
      as('strapi-author', () => L.publish({ documentId: id })));
    await check('Editor cannot publish before approval', 'error', () =>
      as('strapi-editor', () => L.publish({ documentId: id })));
    await check('Editor can approve', 'ok', () =>
      as('strapi-editor', () => L.update({ documentId: id, data: { reviewStatus: 'approved' } })));
    await check('Editor can publish once approved', 'ok', () =>
      as('strapi-editor', () => L.publish({ documentId: id })));
    await check('Published version exists', 'ok', async () => {
      const pub = await L.findOne({ documentId: id, status: 'published' });
      if (!pub) throw new Error('no published version');
    });
  } finally {
    for (const d of created.lessons) await L.delete({ documentId: d }).catch(() => {});
    if (created.unit) await strapi.documents('api::unit.unit').delete({ documentId: created.unit }).catch(() => {});
    if (created.subject) await strapi.documents('api::subject.subject').delete({ documentId: created.subject }).catch(() => {});
    for (const f of created.files) await files.delete({ where: { id: f } }).catch(() => {});
    console.log('\nRESULTS');
    for (const [s, n, m] of results) console.log(`${s}  ${n}  ->  ${m}`);
    const fails = results.filter((r) => r[0] === 'FAIL').length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    await strapi.destroy();
    process.exit(fails ? 1 : 0);
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
