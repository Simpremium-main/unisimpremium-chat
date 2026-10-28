import { buildTsQuery, normalizeText, renderKnowledgeSection } from '../ai-agents/knowledge/knowledge.service';
import { appendRule, learnedRules, parseJsonObject, LEARNED_RULES_HEADER } from './learning-prompt';
import { learningProblems, normalizeLearning } from './learning.types';

describe('base de conhecimento: consulta', () => {
  it('sem acento, sem palavras genéricas', () => {
    expect(normalizeText('Ativação do eSIM')).toBe('ativacao do esim');
    expect(buildTsQuery('O chip funciona em roteador Wi-Fi portátil?')).toBe('roteador | portatil');
    expect(buildTsQuery('meu chip não funciona')).toBeNull();
    expect(buildTsQuery('pedido 142570')).toBeNull(); // número sozinho não busca
  });

  it('bloco do prompt só quando achou algo', () => {
    expect(renderKnowledgeSection([])).toBe('');
    expect(renderKnowledgeSection([{ id: '1', title: 'Modem', content: 'Funciona com chip físico.', rank: 0.3 }])).toContain(
      '- Modem: Funciona com chip físico.',
    );
  });
});

describe('aprendizado', () => {
  it('normaliza a proposta do modelo', () => {
    const l = normalizeLearning({
      tipo: 'temporario',
      titulo: ' Greve ',
      conteudo: 'x',
      expira_em: '30/11/2026',
      mensagens: 'uma',
      atualizar: { tipo: 'conhecimento', id: 'k1' },
    });
    expect(l).toMatchObject({ tipo: 'TEMPORARIO', titulo: 'Greve', expira_em: null, mensagens: ['uma'], atualizar: { tipo: 'CONHECIMENTO', id: 'k1' } });
    expect(learningProblems(l)).toEqual(['Informe até quando vale (data)']);
    expect(normalizeLearning({ tipo: 'outra coisa' }).tipo).toBe('NENHUM');
    expect(learningProblems({ tipo: 'FLUXO', titulo: 't' })).toEqual([
      'Informe quando o fluxo deve ser usado (gatilho)',
      'Informe ao menos uma mensagem do fluxo',
    ]);
  });

  it('JSON embrulhado em ```json', () => {
    expect(parseJsonObject('Claro!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('sem json')).toBeNull();
  });

  it('regras aprendidas: cria a seção, acrescenta e lê, sem mexer no resto do prompt', () => {
    const base = 'Você é a assistente.\n\n## Estilo\n- curto';
    const one = appendRule(base, 'Nunca prometa prazo de reembolso.');
    expect(one).toBe(`${base}\n\n${LEARNED_RULES_HEADER}\n- Nunca prometa prazo de reembolso.\n`);
    const two = appendRule(`${one}\n## Outra seção\ntexto`, 'Sempre confirme o destino.');
    expect(learnedRules(two)).toEqual(['Nunca prometa prazo de reembolso.', 'Sempre confirme o destino.']);
    expect(two).toContain('## Outra seção\ntexto');
    expect(learnedRules(base)).toEqual([]);
  });
});
