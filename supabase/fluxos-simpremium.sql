-- ════════════════════════════════════════════════════════════════════
-- UniSimpremium — fluxos de mensagens fixas da IA (Jarvis → Fluxos)
--
-- Rode no SQL Editor do Supabase. Cria 9 fluxos (ativos, para todos os
-- agentes). Fluxo que já existir com o mesmo identificador NÃO é alterado —
-- é seguro rodar de novo. Depois, edite os textos à vontade em Jarvis → Fluxos.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.add_flow(
  p_org TEXT, p_slug TEXT, p_name TEXT, p_group TEXT, p_sort INT,
  p_trigger TEXT, p_instructions TEXT, p_steps TEXT[]
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  pid TEXT;
  i INT;
BEGIN
  INSERT INTO "ai_playbooks"
    (id, organization_id, agent_id, name, slug, trigger, instructions, group_name, is_active, sort_order, created_at, updated_at)
  VALUES
    (gen_random_uuid()::text, p_org, NULL, p_name, p_slug, p_trigger, p_instructions, p_group, true, p_sort, now(), now())
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id INTO pid;

  IF pid IS NULL THEN
    RETURN p_slug || ': já existia (mantido como está)';
  END IF;
  FOR i IN 1 .. array_length(p_steps, 1) LOOP
    INSERT INTO "ai_playbook_steps" (id, playbook_id, position, type, content, created_at)
    VALUES (gen_random_uuid()::text, pid, i - 1, 'TEXT', p_steps[i], now());
  END LOOP;
  RETURN p_slug || ': criado (' || array_length(p_steps, 1) || ' mensagens)';
END $$;

DO $$
DECLARE
  org TEXT;
  n INT;
  msg TEXT;
BEGIN
  -- Organização da Simpremium (se houver mais de uma, troque pelo id: org := '...';)
  SELECT count(*) INTO n FROM "organizations" WHERE deleted_at IS NULL AND (slug ILIKE 'simpremium%' OR name ILIKE '%simpremium%');
  IF n <> 1 THEN
    RAISE EXCEPTION 'Achei % organizações com "simpremium" no nome — defina o id manualmente neste script', n;
  END IF;
  SELECT id INTO org FROM "organizations" WHERE deleted_at IS NULL AND (slug ILIKE 'simpremium%' OR name ILIKE '%simpremium%');

  msg := pg_temp.add_flow(org, 'cotacao-de-chip', 'Apresentação do chip', 'Vendas', 10,
    'Cliente quer saber como funciona o chip ou quer comprar, e AINDA NÃO informou destino.',
    'Envie uma única vez por conversa. Se o cliente já informou destino, duração ou datas, NÃO envie — vá direto para o que falta ou para a cotação.',
    ARRAY[
$t$Temos duas opções de chip: fisico e virtual.
O chip físico é enviado para o seu endereço e o virtual por email, ou seja, não terá custo de frete.$t$,
$t$Para verificar se o seu aparelho é compatível com chip virtual, entre em:
- *iPhone*: Entre em Ajustes > Celular e veja se há a opção Adicionar eSIM.
- *Samsung*: Entre em Configurações > Conexões > Gerenciamento de Chip e veja se há a opção Adicionar eSIM.
- *Motorola/Xiaomi*: Entre em Configurações > Rede e Internet > Conexões SIM e veja se tem a opção de adicionar ou gerencia eSIM.$t$,
$t$Sobre nossos planos, trabalhamos com planos customizados, ou seja, você irá informar os países que visitará e informaremos as opções disponíveis.$t$,
$t$Dessa forma você economizará e terá o melhor custo do mercado!$t$,
$t$Segue link do chip virtual:
https://simpremium.com.br/produto/chip-virtual$t$,
$t$E link do chip físico:
https://simpremium.com.br/produto/chip-fisico$t$,
$t$Para ver as opções disponíveis basta informar o periodo da viagem e os países de destino.$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'verificar-esim', 'Verificar compatibilidade eSIM', 'Vendas', 20,
    'Cliente escolheu chip virtual/eSIM e ainda não recebeu o caminho de verificação; OU citou o modelo do aparelho ("tenho um iPhone 17") ou perguntou se o aparelho é compatível com eSIM — mesmo sem ter escolhido o tipo de chip.',
    'Envie direto, sem perguntar se o cliente quer ver. Não confirme nem negue compatibilidade. Se o tipo de chip ainda não foi escolhido, depois do fluxo pergunte uma vez: "Depois de verificar, prefere seguir com o chip físico ou virtual?". Se o cliente disser que a opção não aparece, informe que o aparelho não aceita eSIM e ofereça o chip físico.',
    ARRAY[
$t$Para verificar se o seu aparelho é compatível com chip virtual, entre em:
- *iPhone*: Entre em Ajustes > Celular e veja se há a opção Adicionar eSIM.
- *Samsung*: Entre em Configurações > Conexões > Gerenciamento de Chip e veja se há a opção Adicionar eSIM.
- *Motorola/Xiaomi*: Entre em Configurações > Rede e Internet > Conexões SIM e veja se tem a opção de adicionar ou gerencia eSIM.$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'compatibilidade-eua', 'Compatibilidade de rede nos EUA', 'Vendas', 30,
    'Cliente pergunta se o chip funciona nos EUA, ou a cotação é para os EUA e a compatibilidade do aparelho é relevante.',
    'É sobre bandas de rede 4G nos EUA — não tem relação com compatibilidade eSIM.',
    ARRAY[
$t$Para ser compatível nos EUA é preciso operar nas redes 2, 4 e 12 da rede 4G LTE.
Essa restrição é para todas as operadoras neste país e não só com a Tmobile que trabalhamos.
Todos os aparelhos Iphone são compatíveis.
Para aparelhos Android é preciso checar se possui as bandas citadas acima, recomendamos verificar em: www.maiscelular.com.br$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'fechamento-whatsapp', 'Fechar compra pelo WhatsApp (PIX)', 'Vendas', 40,
    'Depois da cotação, o cliente escolhe fechar a compra pelo WhatsApp.',
    'Logo depois de enviar, chame escalar_para_humano (department: vendas) com plano, preço, destino, período, tipo de chip e e-mail (se houver). Não espere o comprovante.',
    ARRAY[
$t$A nossa chave PIX é:
*pix@simpremium.com.br*$t$,
$t$Para finalizarmos o pedido aqui pelo WhatsApp, basta nos *enviar o comprovante e os dados abaixo*:

- Nome Completo;
- E-mail para contato;
- WhatsApp para contato;
- Destino e periodo da viagem.$t$,
$t$Obs.: cotação válida nas condições informadas e por 48hs.$t$,
$t$Ah, lembramos que *cobrimos o preço da concorrência*, para você ter a certeza de estar fazendo a melhor escolha!$t$,
$t$*Chegue já no seu destino conectado!* Garanta já o seu chip conosco! 💛$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'fechamento-site-virtual', 'Fechar pelo site — chip virtual', 'Vendas', 50,
    'Cliente vai comprar o chip VIRTUAL pelo site (em qualquer momento da conversa).',
    'Depois de enviar, chame finalizar_atendimento com o resumo da cotação.',
    ARRAY[
$t$https://simpremium.com.br/produto/chip-virtual$t$,
$t$*Chegue já no seu destino conectado!* Garanta já o seu chip conosco! 💛$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'fechamento-site-fisico', 'Fechar pelo site — chip físico', 'Vendas', 60,
    'Cliente vai comprar o chip FÍSICO pelo site (em qualquer momento da conversa).',
    'Depois de enviar, chame finalizar_atendimento com o resumo da cotação.',
    ARRAY[
$t$https://simpremium.com.br/produto/chip-fisico$t$,
$t$*Chegue já no seu destino conectado!* Garanta já o seu chip conosco! 💛$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'pagamento-cartao-reais', 'Pagamento por cartão em reais', 'Vendas', 70,
    'Cliente PEDE para pagar com cartão de crédito em reais.',
    'Só quando o cliente pedir. Depois chame escalar_para_humano (department: vendas) informando que vai pagar por cartão em reais e os dados da cotação.',
    ARRAY[
$t$Segue link para pagamento por cartão de crédito, basta digitar o valor informado na sua cotação:
https://link.mercadopago.com.br/simpremium$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'pagamento-cartao-dolar', 'Pagamento por cartão em dólares', 'Vendas', 80,
    'Cliente PEDE para pagar com cartão de crédito em dólares.',
    'Só quando o cliente pedir. Depois chame escalar_para_humano (department: vendas) informando que vai pagar por cartão em dólares e os dados da cotação.',
    ARRAY[
$t$Segue link para pagamento por cartão de crédito em dólares, basta digitar o valor informado na sua cotação:
https://buy.stripe.com/5kA17e023aMpcpy6oM$t$
    ]);
  RAISE NOTICE '%', msg;

  msg := pg_temp.add_flow(org, 'suporte-resolvido', 'Suporte resolvido', 'Suporte', 90,
    'Depois das instruções de roaming, o cliente confirma que o chip/eSIM voltou a funcionar.',
    'Depois de enviar, chame finalizar_atendimento.',
    ARRAY[
$t$Perfeito!
Se precisar de algo, é só nos chamar!$t$,
$t$Desejamos uma ótima viagem!  💛$t$
    ]);
  RAISE NOTICE '%', msg;
END $$;

-- Conferência: deve listar os 9 fluxos (e o instrucoes-roaming, que já existia).
SELECT p.slug, p.name, p.is_active, count(s.id) AS mensagens
  FROM "ai_playbooks" p LEFT JOIN "ai_playbook_steps" s ON s.playbook_id = p.id
 WHERE p.slug IN ('cotacao-de-chip','verificar-esim','compatibilidade-eua','fechamento-whatsapp',
                  'fechamento-site-virtual','fechamento-site-fisico','pagamento-cartao-reais',
                  'pagamento-cartao-dolar','suporte-resolvido','instrucoes-roaming')
 GROUP BY p.slug, p.name, p.is_active, p.sort_order
 ORDER BY p.sort_order;
