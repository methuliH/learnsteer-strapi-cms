import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

/**
 * Creator -> approver workflow without Strapi Enterprise "Review Workflows".
 *
 * Maps the old CMS roles onto Strapi's built-in admin roles:
 *   Content Creator  -> Author   (writes drafts, submits them with reviewStatus "in_review")
 *   Content Approver -> Editor   (approves / requests changes, publishes)
 *   Super Administrator -> Super Admin
 *
 * Rules enforced here, on top of the role permissions set in the admin panel:
 *   1. Only Editors and Super Admins can publish reviewed content types.
 *   2. Only Editors and Super Admins can set reviewStatus to "approved" or
 *      "changes_requested".
 *   3. Publishing requires reviewStatus "approved".
 *
 * Calls with no admin user in the request (scripts, imports, cron) are not
 * restricted, so data migrations keep working.
 */
const REVIEWED_TYPES = new Set(['api::lesson.lesson']);
const REVIEWER_ROLES = new Set(['strapi-super-admin', 'strapi-editor']);
const REVIEWER_ONLY_STATUSES = new Set(['approved', 'changes_requested']);

type AdminUser = { roles?: { code?: string }[] };

function currentAdmin(strapi: Core.Strapi): AdminUser | null {
  const ctx = strapi.requestContext.get() as { state?: { user?: AdminUser } } | undefined;
  return ctx?.state?.user ?? null;
}

function isReviewer(user: AdminUser): boolean {
  return (user.roles || []).some((r) => r.code && REVIEWER_ROLES.has(r.code));
}

export function registerReviewWorkflow(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    if (!REVIEWED_TYPES.has(context.uid)) return next();

    const user = currentAdmin(strapi);
    if (!user) return next();
    const reviewer = isReviewer(user);
    const params = context.params as {
      documentId?: string;
      data?: { reviewStatus?: string };
    };

    if (context.action === 'create' || context.action === 'update') {
      const status = params.data?.reviewStatus;
      if (status && REVIEWER_ONLY_STATUSES.has(status) && !reviewer) {
        throw new errors.ForbiddenError(
          'Only an Editor (Content Approver) can approve a lesson or request changes.'
        );
      }
    }

    if (context.action === 'publish') {
      if (!reviewer) {
        throw new errors.ForbiddenError(
          'Only an Editor (Content Approver) can publish lessons. Set Review status to "in_review" to submit it.'
        );
      }
      if (params.documentId) {
        const draft = await strapi
          .documents(context.uid as 'api::lesson.lesson')
          .findOne({ documentId: params.documentId, status: 'draft', fields: ['reviewStatus'] });
        if (draft && draft.reviewStatus !== 'approved') {
          throw new errors.ValidationError(
            'Set Review status to "approved" (and save) before publishing.'
          );
        }
      }
    }

    return next();
  });
}
