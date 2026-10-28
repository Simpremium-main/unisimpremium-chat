jest.mock('../../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({ get: jest.fn(async () => null), set: jest.fn(async () => true) })),
}));
import { CustomerOrdersService } from './customer-orders.service';
import { parseCustomers, parseOrders, phoneVariants, samePhone } from './customer-orders.parse';
import { formatPedidosDoTelefone } from './simpremium-format';

describe('telefone → formatos do Pedido Central', () => {
  it('celular BR com e sem nono dígito, com DDI e formatado', () => {
    expect(phoneVariants('5511987654321@s.whatsapp.net'.split('@')[0])).toEqual([
      '11987654321',
      '5511987654321',
      '(11) 98765-4321',
      '1187654321',
    ]);
    // WhatsApp às vezes entrega sem o 9
    expect(phoneVariants('551187654321')[0]).toBe('11987654321');
    expect(phoneVariants('+1 (305) 555-0100')).toEqual(['13055550100', '+13055550100']);
  });

  it('mesmo número ignora DDI, máscara e nono dígito', () => {
    expect(samePhone('(11) 98765-4321', '5511987654321')).toBe(true);
    expect(samePhone('11 8765-4321', '5511987654321')).toBe(true);
    expect(samePhone('(21) 99999-0000', '5511987654321')).toBe(false);
  });
});

describe('respostas do Pedido Central', () => {
  it('cliente em formatos diferentes', () => {
    expect(parseCustomers({ customers: [{ id: 1, first_name: 'Ana', last_name: 'Lima', email: 'a@x.com', billing: { phone: '11987654321' } }] })).toEqual([
      { name: 'Ana Lima', email: 'a@x.com', cpf: null, phone: '11987654321' },
    ]);
    expect(parseCustomers({ nome: 'Ana', email: 'a@x.com', cpf: '123' })[0]).toMatchObject({ name: 'Ana', cpf: '123' });
    expect(parseCustomers([])).toEqual([]);
    expect(parseCustomers({ error: 'Cliente não encontrado' })).toEqual([]);
    expect(parseCustomers({ success: true, data: [] })).toEqual([]);
  });

  it('pedidos WooCommerce e embrulhados, mais recente primeiro', () => {
    const orders = parseOrders({
      orders: [
        { id: 10, status: 'completed', date_created: '2026-09-01T10:00:00', total: '199.90', line_items: [{ name: 'eSIM EUA 15 dias' }] },
        { number: '11', status: 'processing', date_created: '2026-10-20T10:00:00', total: '89.00', line_items: [{ name: 'Chip Europa' }] },
      ],
    });
    expect(orders.map((o) => o.id)).toEqual(['11', '10']);
    expect(orders[1]).toMatchObject({ status: 'completed', total: '199.90', items: [{ name: 'eSIM EUA 15 dias' }] });
    expect(parseOrders({ numero: '55', produto: 'Seguro' })[0]).toMatchObject({ id: '55', items: [{ name: 'Seguro', variants: [] }] });
  });

  it('itens com quantidade, valor e variações', () => {
    const [order] = parseOrders([
      {
        id: 1,
        line_items: [
          {
            name: 'eSIM Europa',
            quantity: 2,
            total: '379.80',
            sku: 'ESIM-EU',
            variation_id: 991,
            meta_data: [
              { key: 'pa_dias', value: '15-dias', display_key: 'Dias', display_value: '<p>15 dias</p>' },
              { key: 'pa_franquia-de-dados', value: 'ilimitado' },
              { key: '_reduced_stock', value: '2' },
              { key: 'detalhes', value: { x: 1 } },
            ],
          },
          { nome: 'Chip físico', attributes: [{ name: 'Operadora', option: 'Vodafone' }], variation: { pa_cor: 'Preto' } },
        ],
      },
    ]);
    expect(order.items[0]).toEqual({
      name: 'eSIM Europa',
      quantity: 2,
      total: '379.80',
      sku: 'ESIM-EU',
      variants: [
        { label: 'Dias', value: '15 dias' },
        { label: 'Franquia de dados', value: 'ilimitado' },
      ],
    });
    expect(order.items[1].variants).toEqual([
      { label: 'Operadora', value: 'Vodafone' },
      { label: 'Cor', value: 'Preto' },
    ]);
  });
});

describe('busca de pedidos pelo telefone', () => {
  function service(responses: Record<string, (p: any) => unknown>) {
    const mcp: any = {
      isConfigured: jest.fn(async () => true),
      call: jest.fn(async (_org: string, tool: string, params: any) => responses[tool](params)),
    };
    return { svc: new CustomerOrdersService(mcp, {} as any), mcp };
  }

  it('tenta os formatos até achar e busca os pedidos pelo e-mail', async () => {
    const { svc, mcp } = service({
      consultar_cliente: (p) => (p.phone === '(11) 98765-4321' ? [{ name: 'Ana', email: 'a@x.com', phone: '(11) 98765-4321' }] : []),
      consultar_pedido: () => [{ id: 7, status: 'processing', line_items: [{ name: 'eSIM' }] }],
    });
    const r = await svc.lookupByPhone('org', '5511987654321');
    expect(r.status).toBe('found');
    expect(r.tried).toEqual(['11987654321', '5511987654321', '(11) 98765-4321']);
    expect(r.orders[0]).toMatchObject({ id: '7', items: [{ name: 'eSIM' }] });
    expect(mcp.call).toHaveBeenLastCalledWith('org', 'consultar_pedido', { email: 'a@x.com' }, expect.any(Number));
  });

  it('ignora cliente de outro telefone (busca que não filtrou)', async () => {
    const { svc } = service({
      consultar_cliente: () => [{ name: 'Outro', email: 'o@x.com', phone: '21999990000' }, { name: 'Mais um', email: 'm@x.com' }],
      consultar_pedido: () => [],
    });
    const r = await svc.lookupByPhone('org', '5511987654321');
    expect(r.status).toBe('not-found');
  });

  it('sem telefone, sem configuração e erro', async () => {
    expect((await service({}).svc.lookupByPhone('org', null)).status).toBe('no-phone');
    const notConfigured = service({});
    notConfigured.mcp.isConfigured.mockResolvedValue(false);
    expect((await notConfigured.svc.lookupByPhone('org', '5511987654321')).status).toBe('not-configured');
    const failing = service({ consultar_cliente: () => { throw new Error('Pedido Central consultar_cliente falhou (500)'); } });
    const r = await failing.svc.lookupByPhone('org', '5511987654321');
    expect(r).toMatchObject({ status: 'error', message: 'Pedido Central consultar_cliente falhou (500)' });
  });

  it('texto pra IA: pedidos com as regras de privacidade, ou orientação pra pedir CPF', () => {
    const found = formatPedidosDoTelefone({
      status: 'found', phone: 'x', tried: [], customer: { name: 'Ana', email: null, cpf: null, phone: null },
      orders: [{
        id: '7', status: 'processing', date: null, total: null,
        items: [{ name: 'eSIM', quantity: 1, total: null, sku: null, variants: [{ label: 'Dias', value: '15' }] }],
        raw: { id: 7, line_items: [{ name: 'eSIM', meta_data: [{ key: '_x', value: 1 }] }] },
      }], fetchedAt: '',
    });
    expect(found).toContain('"pedidos":[{"id":7,"itens":[{"name":"eSIM","quantity":1,"total":null,"sku":null,"variants":[{"label":"Dias","value":"15"}]}]}]');
    expect(found).toContain('NUNCA os repita');
    const none = formatPedidosDoTelefone({ status: 'not-found', phone: 'x', tried: [], customer: null, orders: [], fetchedAt: '' });
    expect(none).toContain('consultar_pedido');
  });
});
