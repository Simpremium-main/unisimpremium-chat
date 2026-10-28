import { InboxViewsService } from './inbox-views.service';

describe('InboxViewsService: IA Ativo acima de Encerrada', () => {
  const view = (id: string, name: string, metadata: Record<string, unknown> = { builtin: true }) => ({ id, name, metadata });

  function setup(views: ReturnType<typeof view>[]) {
    const updates: any[] = [];
    const prisma: any = {
      inboxView: {
        findMany: jest.fn().mockResolvedValue(views),
        update: jest.fn((args) => {
          updates.push(args);
          return args;
        }),
      },
      $transaction: jest.fn(async (ops: any[]) => ops),
    };
    const svc = new InboxViewsService(prisma, {} as any);
    return { place: () => (svc as any).placeAiActiveAboveClosed('o1', 'u1'), updates, prisma };
  }

  it('move IA Ativo para logo acima de Encerrada e marca como feito', async () => {
    const { place, updates } = setup([
      view('a', 'Não lidas'),
      view('b', 'Encerrada'),
      view('c', 'Minha inbox', {}),
      view('d', 'IA Ativo'),
    ]);
    await place();
    const order = updates.filter((u) => 'order' in u.data).sort((x, y) => x.data.order - y.data.order).map((u) => u.where.id);
    expect(order).toEqual(['a', 'd', 'b', 'c']);
    expect(updates.find((u) => u.where.id === 'd' && u.data.metadata)?.data.metadata).toMatchObject({ aiActivePlaced: true });
  });

  it('não mexe de novo depois de posicionado (respeita reordenação manual)', async () => {
    const { place, prisma } = setup([view('b', 'Encerrada'), view('d', 'IA Ativo', { builtin: true, aiActivePlaced: true })]);
    await place();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
