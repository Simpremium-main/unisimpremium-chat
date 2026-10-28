import type { MetadataRoute } from 'next';

/**
 * App instalável (Tela de Início no iPhone/Android). No iPhone, só o app
 * aberto pela Tela de Início recebe notificações (iOS 16.4+).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'UniSimpremium',
    short_name: 'Simpremium',
    description: 'Atendimento da Simpremium: WhatsApp, Instagram e e-mail com equipe e IA',
    id: '/inbox',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
