import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

/**
 * Media fields that must hold PDFs, per content type.
 * A path like "resources[].file" means: the `file` field of every item
 * in the repeatable `resources` component.
 */
const PDF_FIELDS: Record<string, string[]> = {
  'api::lesson.lesson': ['resources[].file'],
  'api::quiz.quiz': ['markingScheme'],
  'api::past-paper.past-paper': ['paper', 'markingScheme'],
  'api::revision-module.revision-module': ['shortNotes', 'essayGuide'],
};

const PDF_MIME = 'application/pdf';

type MediaRef = { id?: number; documentId?: string };

/** Turn whatever the caller sent for a media field into id/documentId refs. */
function toRefs(value: unknown): MediaRef[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(toRefs);
  if (typeof value === 'number') return [{ id: value }];
  if (typeof value === 'string') {
    return /^\d+$/.test(value) ? [{ id: Number(value) }] : [{ documentId: value }];
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.id === 'number' || typeof v.id === 'string') return [{ id: Number(v.id) }];
    if (typeof v.documentId === 'string') return [{ documentId: v.documentId }];
  }
  return [];
}

/** Collect media refs for a field path from the submitted data. */
function collect(data: Record<string, unknown>, path: string): MediaRef[] {
  const [head, field] = path.split('[].');
  if (field) {
    const items = data[head];
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) =>
      item && typeof item === 'object' ? toRefs((item as Record<string, unknown>)[field]) : []
    );
  }
  return head in data ? toRefs(data[head]) : [];
}

export function registerPdfOnly(strapi: Core.Strapi) {
  const maxMb = Number(process.env.PDF_MAX_MB || 50);

  strapi.documents.use(async (context, next) => {
    const fields = PDF_FIELDS[context.uid];
    if (!fields || (context.action !== 'create' && context.action !== 'update')) {
      return next();
    }

    const data = ((context.params as { data?: Record<string, unknown> }).data || {}) as Record<
      string,
      unknown
    >;
    const refs = fields.flatMap((path) => collect(data, path));
    if (refs.length === 0) return next();

    const ids = refs.filter((r) => r.id !== undefined).map((r) => r.id as number);
    const documentIds = refs.filter((r) => r.documentId).map((r) => r.documentId as string);

    const files = await strapi.db.query('plugin::upload.file').findMany({
      where: {
        $or: [
          ...(ids.length ? [{ id: { $in: ids } }] : []),
          ...(documentIds.length ? [{ documentId: { $in: documentIds } }] : []),
        ],
      },
      select: ['id', 'name', 'mime', 'size'],
    });

    for (const file of files) {
      if (file.mime !== PDF_MIME) {
        throw new errors.ValidationError(
          `"${file.name}" is not a PDF (${file.mime}). Only PDF files can be attached here.`
        );
      }
      // Strapi stores upload size in KB.
      if (Number(file.size) > maxMb * 1024) {
        throw new errors.ValidationError(
          `"${file.name}" is larger than the ${maxMb} MB limit for PDFs.`
        );
      }
    }

    return next();
  });
}
