'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, MessageSquare, Building2 } from 'lucide-react';
import { registerSchema, type RegisterFormData } from '../schemas/register.schema';
import { authService } from '../services/auth.service';
import { useAuthStore } from '@/stores/auth-store';

// Cadastro aberto desligado por padrão (o servidor também recusa sem convite).
const PUBLIC_SIGNUP = process.env.NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP === 'true';

interface InviteInfo {
  email: string;
  role: string;
  organization: { id: string; name: string; slug: string };
}

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth, setActiveOrg } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const inviteToken = searchParams!.get('invite');

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  // Validate invite token on mount
  useEffect(() => {
    if (!inviteToken) return;
    setInviteLoading(true);
    authService
      .validateInvitation(inviteToken)
      .then((info) => {
        setInviteInfo(info);
        form.setValue('email', info.email);
      })
      .catch(() => {
        toast.error('Convite inválido ou expirado');
      })
      .finally(() => setInviteLoading(false));
  }, [inviteToken, form]);

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      const result = await authService.register({
        name: data.name,
        email: data.email,
        password: data.password,
        inviteToken: inviteToken || undefined,
      });

      localStorage.setItem('access_token', result.accessToken);
      localStorage.setItem('refresh_token', result.refreshToken);

      setAuth(result.user, result.organizations);
      setActiveOrg(result.organizations[0].id);

      toast.success(
        inviteInfo
          ? `Bem-vindo! Você entrou em ${inviteInfo.organization.name}`
          : 'Conta criada com sucesso!',
      );
      router.push('/inbox');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  if (inviteLoading) {
    return (
      <div className="mx-auto flex w-full max-w-sm items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Sem convite válido não há cadastro (o servidor também recusa).
  if (!PUBLIC_SIGNUP && !inviteInfo) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
          <MessageSquare className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Cadastro por convite</h1>
          <p className="text-sm text-muted-foreground">
            {inviteToken
              ? 'Este convite é inválido ou expirou. Peça um novo link ao administrador.'
              : 'Para criar uma conta, use o link de convite enviado pelo administrador.'}
          </p>
        </div>
        <Link href="/login" className="inline-block text-sm font-medium text-primary hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-8">
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
          <MessageSquare className="h-6 w-6 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Criar Conta</h1>
        {inviteInfo ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Você foi convidado para entrar em:
            </p>
            <div className="inline-flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary">
              <Building2 className="h-4 w-4" />
              {inviteInfo.organization.name}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Crie sua conta para começar a atender
          </p>
        )}
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            Nome
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Seu nome"
            {...form.register('name')}
          />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            readOnly={!!inviteInfo}
            className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              inviteInfo ? 'cursor-not-allowed bg-muted' : ''
            }`}
            placeholder="seu@email.com"
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Mínimo 6 caracteres"
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            Confirmar senha
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Repita a senha"
            {...form.register('confirmPassword')}
          />
          {form.formState.errors.confirmPassword && (
            <p className="text-xs text-destructive">
              {form.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {inviteInfo ? 'Criar conta e entrar' : 'Criar conta'}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Fazer login
        </Link>
      </p>
    </div>
  );
}
