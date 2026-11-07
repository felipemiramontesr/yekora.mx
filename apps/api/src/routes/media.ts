/**
 * Public product media (FC 029 F1, ADR 0012): `GET /v1/media/:sha256`.
 *
 * The digest is the address and the proof: the route answers 200 only when the stored bytes
 * hash to it (T2.2c), so the answer can be cached for a year as immutable. The site, on
 * yekora.mx, shows these images from apiv1.yekora.mx: Helmet's default
 * `Cross-Origin-Resource-Policy: same-origin` would block them, so this answer says `same-site`
 * (still refused to any other site), and `nosniff` keeps the browser on the stored type.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import type { Db } from '../services/db';
import { matchesDigest, readMedia, SHA256_HEX } from '../services/media';

/** Path parameters of `GET /v1/media/:sha256`; also the request of the API contract. */
export const mediaParams = z.object({ sha256: z.string().regex(SHA256_HEX) });

/** Cache policy of an image: the digest never points to other bytes (T2.2c). */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Registers the media route.
 *
 * @param app - Fastify instance.
 * @param deps - Database port.
 */
export function registerMediaRoutes(
  app: FastifyInstance,
  deps: { db: Db }
): void {
  app.get('/v1/media/:sha256', async (request, reply) => {
    const params = mediaParams.safeParse(request.params);
    if (!params.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid media digest'));
    }
    const { sha256 } = params.data;
    const media = await readMedia(deps.db, sha256);
    if (!media) {
      return reply
        .code(404)
        .type(PROBLEM_TYPE)
        .send(problem(404, 'Media not found'));
    }
    if (!matchesDigest(media.data, sha256)) {
      request.log.error({ sha256 }, 'media blob does not match its digest');
      return reply
        .code(500)
        .type(PROBLEM_TYPE)
        .send(problem(500, 'Internal error'));
    }
    return reply
      .type(media.mimeType)
      .header('cache-control', IMMUTABLE)
      .header('cross-origin-resource-policy', 'same-site')
      .header('x-content-type-options', 'nosniff')
      .send(media.data);
  });
}
