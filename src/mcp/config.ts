export const config = {
  /**
   * URL base da API do UniSimpremium. No modo HTTP (rota /mcp do próprio app)
   * o padrão é a origem da request; no stdio usa esta variável.
   */
  baseUrl: process.env.UNISIMPREMIUM_BASE_URL || process.env.CHAT_BULLQ_BASE_URL || process.env.APP_URL || 'http://localhost:3000',
  apiKey: process.env.UNISIMPREMIUM_API_KEY || process.env.CHAT_BULLQ_API_KEY || '',
};
