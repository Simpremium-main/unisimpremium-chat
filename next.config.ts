import type { NextConfig } from 'next';

/**
 * Pacotes da API (Nest/BullMQ/Prisma…) carregados do node_modules em
 * runtime em vez de empacotados: preserva o comportamento original
 * (require dinâmico de dependências opcionais do Nest) e garante uma única
 * instância de cada módulo — o rastreio de filas em runtime/workers.ts
 * depende de o `bullmq` ser o mesmo usado pelo @nestjs/bullmq.
 */
const serverExternalPackages = [
  '@anthropic-ai/sdk',
  '@nestjs/bull-shared',
  '@nestjs/bullmq',
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/core',
  '@nestjs/jwt',
  '@nestjs/passport',
  '@nestjs/platform-express',
  '@nestjs/swagger',
  '@prisma/client',
  '@supabase/supabase-js',
  'bcrypt',
  'bullmq',
  'class-transformer',
  'class-validator',
  'eta',
  'express',
  'ffmpeg-static',
  'helmet',
  'ioredis',
  'openai',
  'passport',
  'passport-custom',
  'passport-jwt',
  'pg',
  'reflect-metadata',
  'swagger-ui-dist',
  'web-push',
];

const nextConfig: NextConfig = {
  serverExternalPackages,
  experimental: {
    // Não minificar o código de servidor: o Nest depende de nomes de classe
    // (contexto dos logs, nomes de schema no Swagger, `exception.name` nas
    // respostas de erro). Só vale para o build com webpack — por isso o
    // `npm run build` usa `next build --webpack` (o browser continua
    // minificado; o equivalente no Turbopack desligaria a minificação do
    // browser também).
    serverMinification: false,
  },
  // Arquivos lidos via fs em runtime (não rastreáveis por require) — só na
  // função da API: ffmpeg (transcodificação de áudio) e assets do Swagger UI.
  // (colchetes escapados: a chave é um glob e `[[...slug]]` seria lido como
  // classe de caracteres)
  outputFileTracingIncludes: {
    '/api/\\[\\[...slug\\]\\]': [
      './node_modules/ffmpeg-static/ffmpeg',
      './node_modules/swagger-ui-dist/**/*',
    ],
  },
  // Nunca empacotar arquivos .env (o @nestjs/config os procura no cwd e o
  // rastreio os incluiria num deploy feito a partir de build local). Na
  // Vercel as variáveis vêm do painel do projeto.
  outputFileTracingExcludes: {
    '/api/**/*': ['.env', '.env.*'],
  },
  async redirects() {
    return [
      {
        source: '/settings',
        destination: '/settings/channels',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      // Swagger da API (antes em <api-host>/docs).
      { source: '/docs', destination: '/api/docs' },
      { source: '/docs/:path*', destination: '/api/docs/:path*' },
      { source: '/docs-json', destination: '/api/docs-json' },
      // MCP (antes em <mcp-host>/mcp e /health).
      { source: '/mcp', destination: '/api/mcp' },
      { source: '/mcp/health', destination: '/api/mcp/health' },
    ];
  },
};

export default nextConfig;
