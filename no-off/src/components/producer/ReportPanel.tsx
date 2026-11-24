'use client';
import { useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
// O relatório é gerado no servidor (a função SQL confere se a festa é sua).
import { producerApi } from '@/services/api-client';

type Section = 'completo' | 'compradores' | 'vip' | 'faturamento';
const SECTIONS: { value: Section; label: string; text: string }[] = [
  { value: 'completo', label: 'Relatório completo', text: 'Compradores, lista VIP e faturamento em um só arquivo.' },
  { value: 'compradores', label: 'Compradores', text: 'Nome, CPF, e-mail, celular, lote, valor, data, status do pagamento e check-in.' },
  { value: 'vip', label: 'Lista VIP', text: 'Todos os nomes, observações e status de presença.' },
  { value: 'faturamento', label: 'Faturamento', text: 'Bruto, taxas, líquido, total e quantidade por lote e por forma de pagamento.' },
];

export function ReportPanel({ eventId }: { eventId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (section: Section, format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(`${section}-${format}`);
    try {
      const { blob, name } = await producerApi.reportFile(eventId, format, section);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao gerar o relatório.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="mb-6 max-w-2xl text-[12px] leading-relaxed text-mute">
        Os relatórios contêm dados pessoais dos compradores (LGPD). Use-os apenas para o controle de acesso e a prestação de contas da festa.
        Cada geração fica registrada no log de auditoria.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.value} className="card flex flex-col justify-between gap-5 p-6">
            <div>
              <p className="font-display text-[17px] font-bold uppercase tracking-tight">{s.label}</p>
              <p className="mt-2 text-[12px] text-mute">{s.text}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={!!busy} onClick={() => download(s.value, 'xlsx')} className="btn-ghost btn-sm"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</button>
              <button disabled={!!busy} onClick={() => download(s.value, 'csv')} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /> CSV</button>
              <button disabled={!!busy} onClick={() => download(s.value, 'pdf')} className="btn-ghost btn-sm"><FileText className="h-3.5 w-3.5" /> PDF</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
