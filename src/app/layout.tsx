import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Uni',
  description: 'Atendimento da Uni: grupos de WhatsApp com equipe e IA',
  // App na Tela de Início do iPhone (tela cheia, ícone e nome).
  appleWebApp: { capable: true, title: 'Uni', statusBarStyle: 'default' },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className="bg-white lg:bg-zinc-100 dark:bg-zinc-900 dark:lg:bg-zinc-950"
    >
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
