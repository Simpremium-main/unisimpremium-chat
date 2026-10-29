import { redirect } from 'next/navigation';

// "Pedidos consultados" virou "Solicitações" (todas as solicitações à IA nos grupos).
export default function OrderQueriesRedirect() {
  redirect('/requests');
}
