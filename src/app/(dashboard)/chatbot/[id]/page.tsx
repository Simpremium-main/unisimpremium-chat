'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { FlowEditor } from '@/features/chatbot/components/flow-editor';
import { chatbotService } from '@/features/chatbot/services/chatbot.service';

export default function ChatbotEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: flow, isLoading, error } = useQuery({
    queryKey: ['chatbot-flow', id],
    queryFn: () => chatbotService.getById(id),
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !flow) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-red-500">Erro ao carregar fluxo</p>
      </div>
    );
  }

  return <FlowEditor flow={flow} />;
}
