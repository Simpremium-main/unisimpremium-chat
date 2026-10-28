'use client';

import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area,
} from 'recharts';
import {
  Activity, Clock, Target, CheckCircle2, TrendingUp, TrendingDown, Minus,
  Bot, Tag as TagIcon, MessageCircle, CalendarClock,
  Star, RotateCcw, ShieldCheck,
} from 'lucide-react';
import { dashboardService, type SparklinePoint } from '@/features/dashboard/services/dashboard.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { Heatmap } from '@/features/dashboard/components/Heatmap';
import { AgentList } from '@/features/dashboard/components/AgentList';

const CHANNEL_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

type TrendDirection = 'higher-is-better' | 'lower-is-better';

function TrendBadge({ value, direction }: { value: number; direction: TrendDirection }) {
  if (value === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-zinc-400">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  }
  const isPositive = direction === 'higher-is-better' ? value > 0 : value < 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value)}%
    </span>
  );
}

function HeroKpi({
  label, value, suffix, trend, trendDirection, icon: Icon, accent, sparkline, sparklineSuffix, footer,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  trend?: number;
  trendDirection?: TrendDirection;
  icon: React.ElementType;
  accent: string;
  sparkline?: SparklinePoint[];
  sparklineSuffix?: string;
  footer?: React.ReactNode;
}) {
  const gradientId = `grad-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="relative flex flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}1a`, color: accent }}>
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
          {value}
          {suffix && <span className="ml-0.5 text-lg text-zinc-400">{suffix}</span>}
        </span>
        {trend !== undefined && trendDirection && <TrendBadge value={trend} direction={trendDirection} />}
      </div>

      {sparkline && sparkline.length > 0 && (
        <div className="mt-3 -mx-1 h-12">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={{ stroke: accent, strokeWidth: 1, strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'rgba(24,24,27,0.92)', border: 'none', borderRadius: 6,
                  fontSize: 11, padding: '4px 8px', color: '#fff',
                }}
                labelFormatter={(d) => (typeof d === 'string' ? d.slice(5) : '')}
                formatter={(v) => [`${v}${sparklineSuffix ?? ''}`, '']}
                separator=""
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={accent}
                strokeWidth={1.75}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {footer && <div className="mt-2 text-[11px] text-zinc-500">{footer}</div>}
    </div>
  );
}

function HeroSkeleton() {
  return <div className="h-44 animate-pulse rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />;
}

function ChartCard({
  title, icon: Icon, children, height = 'h-64', subtitle,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  height?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {Icon && <Icon className="h-4 w-4 text-zinc-400" />}
            {title}
          </h3>
          {subtitle && <p className="text-[11px] text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      <div className={`mt-4 ${height}`}>{children}</div>
    </div>
  );
}

const tooltipStyle = {
  background: 'rgba(24,24,27,0.92)', border: 'none', borderRadius: 6,
  fontSize: 11, padding: '6px 10px', color: '#fff',
};

export default function DashboardPage() {
  const orgId = useOrgId();
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ['dashboard-overview', orgId],
    queryFn: () => dashboardService.getOverview(),
  });
  const { data: sparklines } = useQuery({
    queryKey: ['dashboard-sparklines', orgId],
    queryFn: () => dashboardService.getKpiSparklines(),
  });
  const { data: volumeFlow } = useQuery({
    queryKey: ['dashboard-volume-flow', orgId],
    queryFn: () => dashboardService.getVolumeFlow(),
  });
  const { data: messagesFlow } = useQuery({
    queryKey: ['dashboard-messages-flow', orgId],
    queryFn: () => dashboardService.getMessagesFlow(),
  });
  const { data: peakHours } = useQuery({
    queryKey: ['dashboard-peak-hours', orgId],
    queryFn: () => dashboardService.getPeakHours(),
  });
  const { data: volumeByChannel } = useQuery({
    queryKey: ['dashboard-volume-channel', orgId],
    queryFn: () => dashboardService.getVolumeByChannel(),
  });
  const { data: botPerf } = useQuery({
    queryKey: ['dashboard-bot-performance', orgId],
    queryFn: () => dashboardService.getBotPerformance(),
  });
  const { data: topTags } = useQuery({
    queryKey: ['dashboard-top-tags', orgId],
    queryFn: () => dashboardService.getTopTags(),
  });
  const { data: agents } = useQuery({
    queryKey: ['dashboard-agents', orgId],
    queryFn: () => dashboardService.getAgentPerformance(),
  });
  const { data: csat } = useQuery({
    queryKey: ['dashboard-csat', orgId],
    queryFn: () => dashboardService.getCsat(),
  });
  const { data: reopens } = useQuery({
    queryKey: ['dashboard-reopens', orgId],
    queryFn: () => dashboardService.getReopens(),
  });

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-6">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500">Últimos 30 dias</p>

      {/* HERO KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loadingOverview || !overview ? (
          <>
            <HeroSkeleton /><HeroSkeleton /><HeroSkeleton /><HeroSkeleton />
          </>
        ) : (
          <>
            <HeroKpi
              label="Conversas ativas"
              value={overview.activeConversations}
              icon={Activity}
              accent="#3b82f6"
              sparkline={sparklines?.active}
              footer={
                <span>
                  {overview.activeBreakdown.pending} fila · {overview.activeBreakdown.open} aberta · {overview.activeBreakdown.waiting} aguardando
                  {overview.stuckConversations > 0 ? (
                    <>
                      {' · '}
                      <a
                        href="/inbox?stuck=true"
                        className="font-medium text-amber-600 hover:underline dark:text-amber-400"
                      >
                        {overview.stuckConversations} presa{overview.stuckConversations === 1 ? '' : 's'}
                      </a>
                    </>
                  ) : null}
                </span>
              }
            />
            <HeroKpi
              label="Tempo 1ª resposta"
              value={overview.avgFirstResponseMinutes ?? '—'}
              suffix={overview.avgFirstResponseMinutes !== null ? 'min' : undefined}
              trend={overview.avgFirstResponseTrend}
              trendDirection="lower-is-better"
              icon={Clock}
              accent="#f59e0b"
              sparkline={sparklines?.firstResponse}
              sparklineSuffix="min"
              footer={<span>Média do período · menor é melhor</span>}
            />
            <HeroKpi
              label="SLA Compliance"
              value={overview.slaCompliancePercent ?? '—'}
              suffix={overview.slaCompliancePercent !== null ? '%' : undefined}
              trend={overview.slaTrend}
              trendDirection="higher-is-better"
              icon={Target}
              accent="#10b981"
              sparkline={sparklines?.sla}
              sparklineSuffix="%"
              footer={
                overview.slaCompliancePercent === null
                  ? <span className="text-amber-500">SLA do depto. não configurado</span>
                  : <span>% conversas dentro do SLA</span>
              }
            />
            <HeroKpi
              label="Taxa de resolução"
              value={overview.resolutionRatePercent ?? '—'}
              suffix={overview.resolutionRatePercent !== null ? '%' : undefined}
              trend={overview.resolutionTrend}
              trendDirection="higher-is-better"
              icon={CheckCircle2}
              accent="#8b5cf6"
              sparkline={sparklines?.resolution}
              sparklineSuffix="%"
              footer={<span>Fechadas / abertas no período</span>}
            />
          </>
        )}
      </div>

      {/* Quality KPIs row */}
      {overview && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <HeroKpi
            label="CSAT"
            value={overview.csatScore ?? '—'}
            suffix={overview.csatScore !== null ? '/5' : undefined}
            trend={overview.csatScore !== null ? Math.round(overview.csatTrend * 10) : 0}
            trendDirection="higher-is-better"
            icon={Star}
            accent="#eab308"
            footer={
              overview.csatResponses === 0
                ? <span className="text-zinc-400">Aguardando primeiras avaliações</span>
                : <span>{overview.csatResponses} resposta{overview.csatResponses === 1 ? '' : 's'} no período</span>
            }
          />
          <HeroKpi
            label="FCR (sem reabertura)"
            value={overview.fcrPercent ?? '—'}
            suffix={overview.fcrPercent !== null ? '%' : undefined}
            icon={ShieldCheck}
            accent="#0ea5e9"
            footer={<span>% das fechadas que não foram reabertas</span>}
          />
          <HeroKpi
            label="Taxa de reabertura"
            value={reopens?.reopenRate ?? '—'}
            suffix={reopens?.reopenRate !== null && reopens?.reopenRate !== undefined ? '%' : undefined}
            icon={RotateCcw}
            accent="#ef4444"
            footer={
              reopens
                ? <span>{reopens.uniqueConversationsReopened} conversa{reopens.uniqueConversationsReopened === 1 ? '' : 's'} reaberta{reopens.uniqueConversationsReopened === 1 ? '' : 's'} · {reopens.totalReopens} total</span>
                : <span>Carregando…</span>
            }
          />
        </div>
      )}

      {/* ROW 1 — fluxo + heatmap */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Volume × resolução" subtitle="Conversas criadas vs fechadas por dia">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={volumeFlow || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => (typeof d === 'string' ? d : '')} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              <Line type="monotone" dataKey="created" name="Criadas" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="closed" name="Fechadas" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Picos de horário"
          icon={CalendarClock}
          subtitle="Dia da semana × hora (UTC)"
          height=""
        >
          {peakHours ? (
            <Heatmap matrix={peakHours.matrix} max={peakHours.max} accent="#3b82f6" />
          ) : (
            <div className="h-48 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800" />
          )}
        </ChartCard>
      </div>

      {/* ROW 2 — mensagens + canal */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Mensagens" icon={MessageCircle} subtitle="Recebidas vs enviadas">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={messagesFlow || []}>
              <defs>
                <linearGradient id="grad-in" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-out" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => (typeof d === 'string' ? d : '')} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              <Area type="monotone" dataKey="inbound" name="Recebidas" stroke="#06b6d4" fill="url(#grad-in)" strokeWidth={2} />
              <Area type="monotone" dataKey="outbound" name="Enviadas" stroke="#8b5cf6" fill="url(#grad-out)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Por canal" subtitle="Volume de conversas">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volumeByChannel || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="channelName" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(228,228,231,0.3)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {(volumeByChannel || []).map((_, i) => (
                  <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ROW 3 — bot + tags */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Performance do bot" icon={Bot} subtitle="Resolvidas pelo bot vs encaminhadas" height="">
          {botPerf ? <BotPerformancePanel data={botPerf} /> : <div className="h-32 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800" />}
        </ChartCard>

        <ChartCard title="Top motivos" icon={TagIcon} subtitle="Tags mais frequentes" height="">
          {topTags ? <TopTagsPanel tags={topTags} /> : <div className="h-32 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800" />}
        </ChartCard>
      </div>

      {/* ROW 4 — CSAT + reaberturas */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="CSAT detalhado" icon={Star} subtitle="Distribuição + comentários recentes" height="">
          {csat ? <CsatPanel data={csat} /> : <div className="h-32 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800" />}
        </ChartCard>

        <ChartCard title="Reaberturas" icon={RotateCcw} subtitle="Conversas que voltaram após fechamento" height="">
          {reopens ? <ReopensPanel data={reopens} /> : <div className="h-32 animate-pulse rounded bg-zinc-50 dark:bg-zinc-800" />}
        </ChartCard>
      </div>

      {/* ROW 5 — agentes (full width) */}
      <div className="mt-6">
        <ChartCard title="Performance dos agentes" subtitle="Carga atual + métricas no período" height="">
          <AgentList agents={agents || []} />
        </ChartCard>
      </div>
      </div>
    </div>
  );
}

function BotPerformancePanel({ data }: { data: NonNullable<Awaited<ReturnType<typeof dashboardService.getBotPerformance>>> }) {
  if (data.total === 0) {
    return <p className="py-6 text-center text-xs text-zinc-400">Sem conversas no período</p>;
  }

  const segments = [
    { label: 'Bot resolveu', value: data.botResolved, color: '#3b82f6' },
    { label: 'Encaminhada', value: data.humanHandled, color: '#8b5cf6' },
    { label: 'Em andamento', value: data.inFlight, color: '#71717a' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Resolução pelo bot"
          value={data.botResolutionRate !== null ? `${data.botResolutionRate}%` : '—'}
          accent="#3b82f6"
          hint={`${data.botResolved} conversa${data.botResolved === 1 ? '' : 's'}`}
        />
        <Stat
          label="Taxa de transbordo"
          value={data.escalationRate !== null ? `${data.escalationRate}%` : '—'}
          accent="#8b5cf6"
          hint={`${data.humanHandled} transferida${data.humanHandled === 1 ? '' : 's'}`}
        />
      </div>

      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          {segments.map((s) => (
            <div
              key={s.label}
              style={{ backgroundColor: s.color, width: `${(s.value / data.total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          {segments.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label} <span className="tabular-nums text-zinc-400">{s.value}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, hint }: { label: string; value: string; accent: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/60">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: accent }}>{value}</p>
      {hint && <p className="text-[10px] text-zinc-400">{hint}</p>}
    </div>
  );
}

function CsatPanel({ data }: { data: NonNullable<Awaited<ReturnType<typeof dashboardService.getCsat>>> }) {
  if (data.totalResponses === 0) {
    return <p className="py-6 text-center text-xs text-zinc-400">Nenhuma avaliação respondida ainda</p>;
  }
  const max = Math.max(...Object.values(data.distribution));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Score médio" value={data.avgScore !== null ? `${data.avgScore}/5` : '—'} accent="#eab308" />
        <Stat label="Respostas" value={String(data.totalResponses)} accent="#3b82f6" hint={`de ${data.totalRequested} pedidas`} />
        <Stat
          label="Taxa de resposta"
          value={data.responseRate !== null ? `${data.responseRate}%` : '—'}
          accent="#10b981"
        />
      </div>

      <div className="space-y-1.5">
        {[5, 4, 3, 2, 1].map((s) => {
          const count = data.distribution[s] ?? 0;
          return (
            <div key={s} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-right tabular-nums text-zinc-500">{s}</span>
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              <div className="relative h-3 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded"
                  style={{
                    width: max > 0 ? `${(count / max) * 100}%` : '0%',
                    backgroundColor: s >= 4 ? '#10b981' : s === 3 ? '#f59e0b' : '#ef4444',
                    opacity: 0.8,
                  }}
                />
              </div>
              <span className="w-8 text-right tabular-nums text-zinc-500">{count}</span>
            </div>
          );
        })}
      </div>

      {data.recentComments.length > 0 && (
        <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Comentários recentes</p>
          {data.recentComments.map((c) => (
            <div key={c.id} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{c.contactName}</span>
                <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-2.5 w-2.5 ${i < c.score ? 'fill-yellow-400 text-yellow-400' : 'text-zinc-300 dark:text-zinc-600'}`} />
                  ))}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-400">{c.comment}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReopensPanel({ data }: { data: NonNullable<Awaited<ReturnType<typeof dashboardService.getReopens>>> }) {
  if (data.totalReopens === 0 && data.uniqueConversationsReopened === 0) {
    return <p className="py-6 text-center text-xs text-zinc-400">Nenhuma reabertura no período</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total reaberturas" value={String(data.totalReopens)} accent="#ef4444" />
        <Stat label="Conversas únicas" value={String(data.uniqueConversationsReopened)} accent="#f59e0b" />
        <Stat
          label="Taxa"
          value={data.reopenRate !== null ? `${data.reopenRate}%` : '—'}
          accent="#8b5cf6"
        />
      </div>

      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.series}>
            <defs>
              <linearGradient id="grad-reopen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(d) => (typeof d === 'string' ? d : '')}
              formatter={(v) => [v, 'reaberturas']}
            />
            <Area type="monotone" dataKey="value" stroke="#ef4444" fill="url(#grad-reopen)" strokeWidth={1.75} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {data.worstOffenders.length > 0 && (
        <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Mais reabertas</p>
          {data.worstOffenders.map((o) => (
            <div key={o.conversationId} className="flex items-center justify-between rounded bg-zinc-50 px-3 py-1.5 dark:bg-zinc-800/60">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">{o.contactName}</p>
                <p className="text-[10px] text-zinc-400">{o.agentName ?? 'sem responsável'}</p>
              </div>
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {o.reopenedCount}×
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopTagsPanel({ tags }: { tags: Array<{ id: string; name: string; color: string; count: number }> }) {
  if (tags.length === 0) {
    return <p className="py-6 text-center text-xs text-zinc-400">Nenhuma tag aplicada no período</p>;
  }
  const max = Math.max(...tags.map((t) => t.count));

  return (
    <div className="space-y-2.5">
      {tags.map((t) => (
        <div key={t.id} className="flex items-center gap-3">
          <div className="flex w-32 shrink-0 items-center gap-2 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{t.name}</span>
          </div>
          <div className="flex flex-1 items-center gap-2">
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${(t.count / max) * 100}%`, backgroundColor: t.color, opacity: 0.85 }}
              />
            </div>
            <span className="w-10 text-right text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
              {t.count}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
