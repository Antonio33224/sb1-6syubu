'use client';
/**
 * Abas do painel admin: Cupons, Gratuidades, Auditoria e Segurança.
 * Tudo passa pelas rotas /api/admin/* (papel admin conferido no servidor) e
 * pelas funções SQL admin_* (que conferem de novo e gravam no audit log).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Copy, Mail, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import { FieldError, Modal } from '@/components/ui/Controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { generateCouponCode, isGrantActive, normalizeCouponCode } from '@/lib/coupons';
import { adminApi, apiAvailable, type AdminCoupon, type AdminGrant, type AdminUserHit, type AuditEntry, type CouponInput } from '@/services/api-client';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mute">{hint}</span>}
    </label>
  );
}

function SupabaseOnly({ children }: { children: ReactNode }) {
  if (apiAvailable()) return <>{children}</>;
  return <EmptyState title="Disponível apenas com Supabase" text="Cupons, gratuidades, auditoria e alertas de segurança exigem o banco de dados real. No modo demonstração esta área fica desativada." />;
}

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
/** ISO → valor de <input type="datetime-local"> (horário local). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

// ------------------------------------------------------------------ cupons

type CouponStatus = 'ativo' | 'inativo' | 'expirado' | 'esgotado' | 'agendado';

function couponStatus(c: AdminCoupon, now = Date.now()): CouponStatus {
  if (!c.active) return 'inativo';
  if (c.expires_at && Date.parse(c.expires_at) <= now) return 'expirado';
  if (c.max_redemptions !== null && c.redemptions_count >= c.max_redemptions) return 'esgotado';
  if (c.starts_at && Date.parse(c.starts_at) > now) return 'agendado';
  return 'ativo';
}

const EMPTY_COUPON: CouponInput = { id: null, code: '', description: '', grant_days: 30, max_redemptions: 100, per_user_limit: 1, starts_at: null, expires_at: null, active: true };

export function CouponsAdmin() {
  return (
    <SupabaseOnly>
      <CouponsInner />
    </SupabaseOnly>
  );
}

function CouponsInner() {
  const toast = useToast();
  const { data: coupons, error, reload } = useAsync(() => adminApi.listCoupons(), []);
  const [editing, setEditing] = useState<CouponInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    try {
      await adminApi.saveCoupon({ ...editing, code: normalizeCouponCode(editing.code) });
      toast(editing.id ? 'Cupom atualizado.' : 'Cupom criado.');
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: AdminCoupon) => {
    try {
      await adminApi.setCouponActive(c.id, !c.active);
      toast(c.active ? 'Cupom desativado.' : 'Cupom ativado.');
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Código copiado.');
    } catch {
      toast(code);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!coupons) return <Skeleton className="h-64" />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-xl text-[13px] text-mute">Cada cupom concede N dias de Classify+ completo (gratuidade, sem cobrança). Os resgates são atômicos: limites de uso total e por usuário nunca são ultrapassados, mesmo com cliques simultâneos.</p>
        <button onClick={() => { setFormError(null); setEditing({ ...EMPTY_COUPON, code: generateCouponCode() }); }} className="btn-primary btn-sm">Novo cupom</button>
      </div>

      {coupons.length === 0 ? (
        <div className="mt-8"><EmptyState title="Nenhum cupom" text="Crie o primeiro cupom para distribuir dias de Classify+." /></div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-[10px] uppercase tracking-nav text-mute">
              <tr className="border-b border-line">
                <th className="py-3 pr-4">Código</th><th className="pr-4">Dias</th><th className="pr-4">Usos</th><th className="pr-4">Por usuário</th><th className="pr-4">Validade</th><th className="pr-4">Status</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {coupons.map((c) => {
                const st = couponStatus(c);
                return (
                  <tr key={c.id}>
                    <td className="py-3 pr-4">
                      <button onClick={() => copy(c.code)} className="inline-flex items-center gap-2 font-mono text-bone hover:text-blue" title="Copiar código">
                        {c.code} <Copy className="h-3 w-3" aria-hidden />
                      </button>
                      {c.description && <span className="block text-[11px] text-mute">{c.description}</span>}
                    </td>
                    <td className="pr-4">{c.grant_days}</td>
                    <td className="pr-4">{c.redemptions_count}{c.max_redemptions !== null ? ` / ${c.max_redemptions}` : ' / ∞'}</td>
                    <td className="pr-4">{c.per_user_limit}</td>
                    <td className="pr-4 text-[12px] text-mute">{c.starts_at ? `de ${dateTime(c.starts_at)} ` : ''}{c.expires_at ? `até ${dateTime(c.expires_at)}` : 'sem expiração'}</td>
                    <td className="pr-4"><span className={clsx('chip', st === 'ativo' && 'border-blue text-blue')}>{st}</span></td>
                    <td className="whitespace-nowrap text-right">
                      <button onClick={() => { setFormError(null); setEditing({ ...c }); }} className="btn-ghost btn-sm">Editar</button>
                      <button onClick={() => toggle(c)} className="btn-ghost btn-sm">{c.active ? 'Desativar' : 'Ativar'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar cupom' : 'Novo cupom'} wide>
        {editing && (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="Código" hint="4 a 32 caracteres: A–Z, 0–9 e hífen. Não diferencia maiúsculas.">
              <div className="flex gap-2">
                <input className="field font-mono uppercase" value={editing.code} maxLength={32} required onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
                <button type="button" onClick={() => setEditing({ ...editing, code: generateCouponCode() })} className="btn-ghost btn-sm shrink-0" aria-label="Gerar código aleatório"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
            </Field>
            <Field label="Dias de Classify+"><input className="field" type="number" min={1} max={365} required value={editing.grant_days} onChange={(e) => setEditing({ ...editing, grant_days: Number(e.target.value) })} /></Field>
            <Field label="Limite total de usos" hint="Vazio = ilimitado.">
              <input className="field" type="number" min={1} value={editing.max_redemptions ?? ''} onChange={(e) => setEditing({ ...editing, max_redemptions: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Usos por usuário"><input className="field" type="number" min={1} max={10} required value={editing.per_user_limit} onChange={(e) => setEditing({ ...editing, per_user_limit: Number(e.target.value) })} /></Field>
            <Field label="Começa em (opcional)"><input className="field" type="datetime-local" value={toLocalInput(editing.starts_at)} onChange={(e) => setEditing({ ...editing, starts_at: fromLocalInput(e.target.value) })} /></Field>
            <Field label="Expira em (opcional)"><input className="field" type="datetime-local" value={toLocalInput(editing.expires_at)} onChange={(e) => setEditing({ ...editing, expires_at: fromLocalInput(e.target.value) })} /></Field>
            <div className="sm:col-span-2">
              <Field label="Descrição interna (opcional)"><input className="field" maxLength={200} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="accent-blue" /> Ativo
            </label>
            <div className="sm:col-span-2"><FieldError message={formError} /></div>
            <div className="flex justify-end gap-3 sm:col-span-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost btn-sm">Cancelar</button>
              <button type="submit" disabled={busy} className="btn-primary btn-sm">{busy ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ gratuidades

export function GrantsAdmin() {
  return (
    <SupabaseOnly>
      <GrantsInner />
    </SupabaseOnly>
  );
}

function GrantsInner() {
  const toast = useToast();
  const { data: grants, error, reload } = useAsync(() => adminApi.listGrants(), []);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AdminUserHit[]>([]);
  const [picked, setPicked] = useState<AdminUserHit | null>(null);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminGrant | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || picked) return setHits([]);
    const id = setTimeout(() => {
      adminApi.findUsers(q).then(setHits).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(id);
  }, [query, picked]);

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return setFormError('Escolha um usuário.');
    setBusy(true);
    setFormError(null);
    try {
      const g = await adminApi.grant(picked.id, days, reason);
      toast(`Gratuidade concedida a @${picked.username} até ${formatDate(g.ends_at)}.`);
      setPicked(null);
      setQuery('');
      setReason('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao conceder.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    try {
      await adminApi.revokeGrant(revoking.id, revokeReason);
      toast('Gratuidade revogada.');
      setRevoking(null);
      setRevokeReason('');
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
      <form onSubmit={grant} className="card flex flex-col gap-4 p-6">
        <p className="eyebrow">Conceder gratuidade</p>
        <p className="text-[12px] text-mute">Libera o Classify+ completo, sem cobrança. Se o usuário já tiver uma gratuidade ativa, a nova começa quando ela terminar.</p>
        <Field label="Usuário (nome, @usuário ou e-mail)">
          {picked ? (
            <div className="flex items-center justify-between gap-2 rounded-card border border-blue px-3 py-2 text-[13px]">
              <span>@{picked.username} <span className="text-mute">· {picked.email}</span></span>
              <button type="button" onClick={() => setPicked(null)} className="text-mute hover:text-bone" aria-label="Trocar usuário">×</button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
              <input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" autoComplete="off" />
              {hits.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-card border border-line bg-panel" role="listbox">
                  {hits.map((u) => (
                    <li key={u.id}>
                      <button type="button" onClick={() => { setPicked(u); setHits([]); }} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-ink">
                        @{u.username} <span className="text-mute">· {u.full_name || '—'} · {u.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
        <Field label="Dias"><input className="field" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} required /></Field>
        <Field label="Motivo (fica no audit log)"><input className="field" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} required placeholder="Ex.: parceria com DJ, compensação" /></Field>
        <FieldError message={formError} />
        <button type="submit" disabled={busy} className="btn-primary btn-sm self-start">{busy ? 'Concedendo…' : 'Conceder'}</button>
      </form>

      <div>
        <p className="eyebrow">Gratuidades</p>
        {error ? (
          <div className="mt-4"><ErrorState message={error} onRetry={reload} /></div>
        ) : !grants ? (
          <Skeleton className="mt-4 h-64" />
        ) : grants.length === 0 ? (
          <div className="mt-4"><EmptyState title="Nenhuma gratuidade" text="Gratuidades concedidas aqui ou por cupom aparecem nesta lista." /></div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {grants.map((g) => {
              const active = isGrantActive(g);
              const future = !g.revoked_at && Date.parse(g.starts_at) > Date.now();
              return (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13px]">
                  <div>
                    <p className="text-bone">@{g.user?.username ?? '—'} <span className="text-mute">· {g.source === 'coupon' ? `cupom ${g.coupon?.code ?? ''}` : 'concessão do admin'}</span></p>
                    <p className="text-[12px] text-mute">{dateTime(g.starts_at)} → {dateTime(g.ends_at)}{g.reason ? ` · ${g.reason}` : ''}</p>
                    {g.revoked_at && <p className="text-[12px] text-mute">Revogada em {dateTime(g.revoked_at)}{g.revoke_reason ? ` · ${g.revoke_reason}` : ''}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('chip', active && 'border-blue text-blue')}>{g.revoked_at ? 'revogada' : active ? 'ativa' : future ? 'agendada' : 'encerrada'}</span>
                    {(active || future) && <button onClick={() => setRevoking(g)} className="btn-ghost btn-sm">Revogar</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={!!revoking} onClose={() => setRevoking(null)} title="Revogar gratuidade">
        <p className="text-sm text-mute">O acesso Classify+ concedido por esta gratuidade termina agora para @{revoking?.user?.username}.</p>
        <label className="mt-4 block"><span className="field-label">Motivo</span><input className="field" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} maxLength={300} /></label>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setRevoking(null)} className="btn-ghost btn-sm">Cancelar</button>
          <button onClick={revoke} className="btn-outline btn-sm">Revogar</button>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ auditoria

const ACTION_LABEL: Record<string, string> = {
  'coupon.created': 'Cupom criado',
  'coupon.updated': 'Cupom editado',
  'coupon.activated': 'Cupom ativado',
  'coupon.deactivated': 'Cupom desativado',
  'coupon.redeemed': 'Cupom resgatado',
  'grant.created': 'Gratuidade concedida',
  'grant.revoked': 'Gratuidade revogada',
  'user.role_changed': 'Papel de usuário alterado',
  'settings.updated': 'Configurações alteradas',
  'security_settings.updated': 'Alertas de segurança alterados',
  'security_settings.test_email': 'E-mail de teste enviado',
  'auth.login_failures_alert': 'Alerta: tentativas de login falhas',
  'venues.deleted': 'Estabelecimento excluído',
  'events.deleted': 'Evento excluído',
  'review.moderated': 'Avaliação moderada',
};

export function AuditAdmin() {
  return (
    <SupabaseOnly>
      <AuditInner />
    </SupabaseOnly>
  );
}

function AuditInner() {
  const [severity, setSeverity] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = async (before?: number) => {
    setError(null);
    try {
      const list = await adminApi.audit({ before, severity: severity || undefined });
      setEntries((cur) => (before && cur ? [...cur, ...list] : list));
      setMore(list.length >= 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar.');
    }
  };

  useEffect(() => {
    setEntries(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-[13px] text-mute">Registro imutável de ações administrativas e eventos de segurança. Só administradores leem; ninguém edita.</p>
        <div className="flex items-center gap-2">
          <select className="field h-10 w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filtrar por gravidade">
            <option value="">Todas as gravidades</option>
            <option value="info">Informação</option>
            <option value="warning">Atenção</option>
            <option value="critical">Crítico</option>
          </select>
          <button onClick={() => { setEntries(null); void load(); }} className="btn-ghost btn-sm" aria-label="Atualizar"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {error ? (
        <div className="mt-6"><ErrorState message={error} onRetry={() => load()} /></div>
      ) : !entries ? (
        <Skeleton className="mt-6 h-64" />
      ) : entries.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nada registrado ainda" /></div>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="grid gap-1 py-3 text-[13px] sm:grid-cols-[150px_1fr]">
                <span className="text-[12px] text-mute">{dateTime(e.created_at)}</span>
                <div>
                  <p className="flex flex-wrap items-center gap-2">
                    {e.severity !== 'info' && <ShieldAlert className={clsx('h-4 w-4', e.severity === 'critical' ? 'text-bone' : 'text-blue')} aria-label={e.severity === 'critical' ? 'Crítico' : 'Atenção'} />}
                    <span className="text-bone">{ACTION_LABEL[e.action] ?? e.action}</span>
                    <span className="text-mute">· {e.actor ? `@${e.actor.username}` : 'sistema'}</span>
                  </p>
                  {Object.keys(e.metadata ?? {}).length > 0 && (
                    <p className="mt-1 break-all font-mono text-[11px] text-mute">{Object.entries(e.metadata).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {more && <button onClick={() => load(entries.at(-1)?.id)} className="btn-ghost btn-sm mt-4">Carregar mais</button>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ segurança

export function SecurityAdmin() {
  return (
    <SupabaseOnly>
      <SecurityInner />
    </SupabaseOnly>
  );
}

function SecurityInner() {
  const toast = useToast();
  const { data, error, reload } = useAsync(() => adminApi.security(), []);
  const [email, setEmail] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [windowMin, setWindowMin] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  const s = data.settings;
  if (!s) return <ErrorState message="Configurações de segurança não encontradas. Aplique a migração 0006." onRetry={reload} />;

  const cur = {
    admin_alert_email: email ?? s.admin_alert_email ?? '',
    login_alert_threshold: threshold ?? s.login_alert_threshold,
    login_alert_window_minutes: windowMin ?? s.login_alert_window_minutes,
    login_alert_cooldown_minutes: cooldown ?? s.login_alert_cooldown_minutes,
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await adminApi.saveSecurity(cur);
      toast('Configurações de segurança salvas.');
      setEmail(null); setThreshold(null); setWindowMin(null); setCooldown(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      const r = await adminApi.testEmail();
      toast(`E-mail de teste enviado para ${r.sent_to}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao enviar.', 'error');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={save} className="card flex flex-col gap-5 p-6 sm:p-8">
        <p className="eyebrow">Alertas de login</p>
        <Field label="E-mail do admin padrão" hint="Recebe os alertas de tentativas de login falhas. Fica em uma tabela privada (só admins leem).">
          <input className="field" type="email" value={cur.admin_alert_email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="voce@seudominio.com" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Falhas para alertar"><input className="field" type="number" min={3} max={100} value={cur.login_alert_threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></Field>
          <Field label="Janela (min)"><input className="field" type="number" min={1} max={1440} value={cur.login_alert_window_minutes} onChange={(e) => setWindowMin(Number(e.target.value))} /></Field>
          <Field label="Intervalo entre alertas (min)"><input className="field" type="number" min={5} max={1440} value={cur.login_alert_cooldown_minutes} onChange={(e) => setCooldown(Number(e.target.value))} /></Field>
        </div>
        <p className="text-[12px] text-mute">Dispara quando uma conta acumula {cur.login_alert_threshold} falhas em {cur.login_alert_window_minutes} min (ou um mesmo IP, {cur.login_alert_threshold * 3}). Depois de um alerta, o próximo só sai após {cur.login_alert_cooldown_minutes} min.</p>
        <FieldError message={formError} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className="btn-primary btn-sm">{busy ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" onClick={test} disabled={!data.smtp_configured || !s.admin_alert_email} className="btn-outline btn-sm"><Mail className="h-3.5 w-3.5" /> Enviar e-mail de teste</button>
        </div>
      </form>

      <div className="flex flex-col gap-6">
        <div className="card p-6 sm:p-8">
          <p className="eyebrow">Status</p>
          <dl className="mt-4 grid gap-3 text-[13px]">
            <div className="flex justify-between gap-4"><dt className="text-mute">SMTP no servidor</dt><dd>{data.smtp_configured ? 'configurado' : 'não configurado'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-mute">Último alerta enviado</dt><dd>{dateTime(s.last_login_alert_at)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-mute">Atualizado em</dt><dd>{dateTime(s.updated_at)}</dd></div>
          </dl>
          {!data.smtp_configured && (
            <p className="mt-5 flex gap-2 rounded-card border border-line px-4 py-3 text-[12px] text-mute">
              <AlertTriangle className="h-4 w-4 shrink-0 text-blue" aria-hidden />
              Defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e EMAIL_FROM no servidor para enviar e-mails. Enquanto isso, os alertas ficam registrados na aba Auditoria.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
