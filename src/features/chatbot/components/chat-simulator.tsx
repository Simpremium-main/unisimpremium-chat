'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, RotateCcw } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';

interface ChatSimulatorProps {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}

interface SimMessage {
  from: 'bot' | 'user';
  text: string;
  imageUrl?: string;
}

export function ChatSimulator({ nodes, edges, onClose }: ChatSimulatorProps) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [input, setInput] = useState('');
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [ended, setEnded] = useState(false);
  const [variables, setVariables] = useState<Record<string, any>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const getNode = (id: string) => nodes.find((n) => n.id === id);
  const getEdgesFrom = (id: string) => edges.filter((e) => e.source === id);

  const processNode = (nodeId: string, userInput?: string) => {
    const node = getNode(nodeId);
    if (!node) { setEnded(true); return; }
    const data = node.data as Record<string, any>;
    const outEdges = getEdgesFrom(nodeId);

    switch (node.type) {
      case 'START': {
        const next = outEdges[0]?.target;
        if (next) setTimeout(() => processNode(next), 300);
        else setEnded(true);
        break;
      }
      case 'MESSAGE': {
        const text = (data.message || '').replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => variables[k] ?? `{{${k}}}`);
        const wait = Math.min(15, Math.max(0, Number(data.delaySeconds) || 0)) * 1000;
        setTimeout(() => {
          setMessages((prev) => [...prev, { from: 'bot', text, imageUrl: data.image?.url || undefined }]);
          const next = outEdges[0]?.target;
          if (next) setTimeout(() => processNode(next), 500);
          else setEnded(true);
        }, wait);
        break;
      }
      case 'MENU': {
        if (!userInput) {
          const opts = data.options || [];
          const menuText = [data.title || 'Escolha:', '', ...opts.map((o: any, i: number) => `${i + 1}. ${o.label}`)].join('\n');
          setMessages((prev) => [...prev, { from: 'bot', text: menuText }]);
          setCurrentNodeId(nodeId);
          setWaitingForInput(true);
        } else {
          const opts = data.options || [];
          const idx = parseInt(userInput, 10) - 1;
          const sel = opts[idx] || opts.find((o: any) => o.label.toLowerCase() === userInput.toLowerCase());
          if (!sel) {
            setMessages((prev) => [...prev, { from: 'bot', text: 'Opção inválida. Tente novamente.' }]);
            setWaitingForInput(true);
          } else {
            setVariables((v) => ({ ...v, lastMenuSelection: sel.value }));
            const matchEdge = outEdges.find((e) => e.sourceHandle === `output-${opts.indexOf(sel)}`);
            const next = matchEdge?.target || outEdges[0]?.target;
            if (next) setTimeout(() => processNode(next), 300);
            else setEnded(true);
          }
        }
        break;
      }
      case 'CONDITION': {
        const actual = String(variables[data.variable] ?? '');
        let result = false;
        if (data.operator === 'equals') result = actual === data.value;
        else if (data.operator === 'contains') result = actual.includes(data.value);
        const next = result ? outEdges[0]?.target : (outEdges[1]?.target || outEdges[0]?.target);
        if (next) setTimeout(() => processNode(next), 200);
        else setEnded(true);
        break;
      }
      case 'WAIT': {
        if (!userInput) {
          if (data.prompt) setMessages((prev) => [...prev, { from: 'bot', text: data.prompt }]);
          setCurrentNodeId(nodeId);
          setWaitingForInput(true);
        } else {
          if (data.saveAs) setVariables((v) => ({ ...v, [data.saveAs]: userInput }));
          const next = outEdges[0]?.target;
          if (next) setTimeout(() => processNode(next), 300);
          else setEnded(true);
        }
        break;
      }
      case 'TRANSFER': {
        setMessages((prev) => [
          ...prev,
          { from: 'bot', text: data.message || 'Transferindo para atendente...' },
          { from: 'bot', text: '[→ vai para atendente humano — IA pausada]' },
        ]);
        setEnded(true);
        break;
      }
      case 'END_FLOW': {
        const target =
          data.handoff === 'AI'
            ? '[→ a IA assume a conversa agora]'
            : data.handoff === 'HUMAN'
              ? '[→ vai para atendente humano — IA pausada]'
              : '[⚠ destino não definido — no atendimento real vai para humano]';
        setMessages((prev) => [
          ...prev,
          ...(data.message ? [{ from: 'bot' as const, text: data.message }] : []),
          { from: 'bot' as const, text: target },
        ]);
        setEnded(true);
        break;
      }
    }
  };

  const start = () => {
    setMessages([]);
    setVariables({});
    setEnded(false);
    setWaitingForInput(false);
    const startNode = nodes.find((n) => n.type === 'START');
    if (startNode) processNode(startNode.id);
  };

  useEffect(() => { start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !waitingForInput || !currentNodeId) return;
    setMessages((prev) => [...prev, { from: 'user', text: input.trim() }]);
    setWaitingForInput(false);
    const nodeId = currentNodeId;
    setInput('');
    setTimeout(() => processNode(nodeId, input.trim()), 300);
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 flex h-[480px] w-[340px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between rounded-t-2xl bg-primary px-4 py-3">
        <span className="text-sm font-semibold text-primary-foreground">Simulador do Bot</span>
        <div className="flex gap-1">
          <button onClick={start} className="rounded p-1 text-primary-foreground/70 hover:text-primary-foreground"><RotateCcw className="h-4 w-4" /></button>
          <button onClick={onClose} className="rounded p-1 text-primary-foreground/70 hover:text-primary-foreground"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs ${
              msg.from === 'user'
                ? 'rounded-br-md bg-primary text-primary-foreground'
                : 'rounded-bl-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
            }`}>
              {msg.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.imageUrl} alt="" className={`max-h-48 rounded-lg object-cover ${msg.text ? 'mb-1.5' : ''}`} />
              )}
              {msg.text}
            </div>
          </div>
        ))}
        {ended && (
          <div className="py-2 text-center text-[10px] text-zinc-400">— Fluxo encerrado —</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={!waitingForInput || ended}
            placeholder={ended ? 'Fluxo encerrado' : waitingForInput ? 'Digite...' : 'Aguarde o bot...'}
            className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button
            onClick={handleSend}
            disabled={!waitingForInput || ended || !input.trim()}
            className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
