import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Toda a API Nest (`/api/v1/*`) e o Swagger (`/api/docs`) passam por aqui.
 * O corpo NÃO é parseado pelo Next: o Nest precisa do stream cru (rawBody
 * para assinatura de webhooks, multipart para uploads).
 */
export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
  maxDuration: 300,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // A API é compilada com `tsc` (npm run build:server → .server-build/), o
  // mesmo compilador do projeto Nest original: a metadata de decorators
  // (DI, ValidationPipe, Swagger) fica idêntica. O SWC do Next emite essa
  // metadata de forma diferente para enums do Prisma. O await cobre o caso
  // do bundler entregar o módulo como async (dependências ESM).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handleHttp } = await require('../../../.server-build/http');
  await handleHttp(req, res);
}
