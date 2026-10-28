'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { makeQueryClient } from '@/lib/query-client';
import { DialogsProvider } from '@/components/ui/dialogs';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <DialogsProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </DialogsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
