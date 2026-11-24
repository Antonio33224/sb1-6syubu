'use client';
/**
 * Abas do painel admin: Auditoria e Segurança.
 * Tudo passa pelas rotas /api/admin/* (papel admin conferido no servidor) e
 * pelas funções SQL admin_* (que conferem de novo e gravam no audit log).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Mail, RefreshCw, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { adminApi, type AuditEntry } from '@/services/api-client';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mute">{hint}</span>}
    </label>
  );
}

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// ------------------------------------------------------------------ auditoria

const ACTION_LABEL: Record<string, string> = {
  'user.role_changed': 'Papel de usuário alterado',
  'settings.updated': 'Configurações alteradas',
  'security_settings.updated': 'Alertas de segurança alterados',
  'security_settings.test_email': 'E-mail de teste enviado',
  'auth.login_failures_alert': 'Alerta: tentativas de login falhas',
  'venues.deleted': 'Estabelecimento excluído',
  'events.deleted': 'Evento excluído',
  'review.moderated': 'Avaliação moderada',
  'event.created': 'Festa criada',
  'event.updated': 'Festa editada',
  'event.visibility_changed': 'Visibilidade da festa alterada',
  'event.status_changed': 'Status da festa alterado',
  'batch.insert': 'Lote criado',
  'batch.update': 'Lote editado',
  'batch.delete': 'Lote excluído',
  'order.paid': 'Pedido pago / ingressos emitidos',
  'order.refunded': 'Pedido estornado',
  'order.charged_back': 'Chargeback',
  'order.paid_without_stock': 'Pago sem estoque (estorno automático)',
  'payment.amount_mismatch': 'Valor do pagamento divergente',
  'user.suspended': 'Usuário suspenso',
  'user.reactivated': 'Usuário reativado',
  'report.generated': 'Relatório gerado',
  'reviews.imported': 'Avaliações importadas',
};

export function AuditAdmin() {
  return <AuditInner />;
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
                    {e.severity !== 'info' && <ShieldAlert className={clsx('h-4 w-4', e.severity === 'critical' ? 'text-bone' : 'text-red-bright')} aria-label={e.severity === 'critical' ? 'Crítico' : 'Atenção'} />}
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
  return <SecurityInner />;
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
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-bright" aria-hidden />
              Defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e EMAIL_FROM no servidor para enviar e-mails. Enquanto isso, os alertas ficam registrados na aba Auditoria.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
