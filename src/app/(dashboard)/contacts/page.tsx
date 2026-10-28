import { redirect } from 'next/navigation';

// Página /contacts virou aba de Configurações. Mantemos um redirect aqui
// pra preservar links antigos (bookmarks, deep-links, etc).
export default function ContactsRedirect() {
  redirect('/settings/contacts');
}
