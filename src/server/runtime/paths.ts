import * as os from 'os';
import * as path from 'path';

/**
 * Diretório padrão dos uploads do driver de disco (quando UPLOADS_DIR não
 * está definido): `<cwd>/uploads` localmente, `/tmp/uploads` na Vercel
 * (único caminho gravável). Usado por main/http, UploadsService e
 * MediaUrlResolverService — os três precisam apontar para o mesmo lugar.
 */
export function defaultUploadsDir(): string {
  return path.join(process.env.VERCEL ? os.tmpdir() : workingDir(), 'uploads');
}

// process.cwd() fica atrás de uma função de propósito: o rastreador de
// arquivos do build (nft) não consegue resolvê-lo e, assim, não tenta
// empacotar o projeto inteiro na função serverless.
function workingDir(): string {
  return process.cwd();
}
