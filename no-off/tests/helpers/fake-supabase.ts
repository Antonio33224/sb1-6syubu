/**
 * Supabase falso para testes: aplica filtros simples (eq/neq/in/gte/lte/limit)
 * sobre tabelas em memória e registra todas as operações chamadas.
 */
type Row = Record<string, unknown>;
type RpcImpl = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

export interface FakeCall {
  table: string;
  ops: [string, unknown[]][];
}

export function fakeSupabase(tables: Record<string, Row[]>, rpcs: Record<string, RpcImpl> = {}) {
  const calls: FakeCall[] = [];
  const rpcCalls: [string, Record<string, unknown>][] = [];

  const from = (table: string) => {
    const call: FakeCall = { table, ops: [] };
    calls.push(call);
    let single = false;
    const run = () => {
      // insert: adiciona as linhas (com id sequencial quando ausente) e as devolve.
      const ins = call.ops.find(([op]) => op === 'insert');
      if (ins) {
        const payload = ins[1][0] as Row | Row[];
        const list = (tables[table] ??= []);
        const added = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ id: list.length + i + 1, ...r }));
        list.push(...added);
        return single ? { data: added[0] ?? null, error: null } : { data: added, error: null };
      }
      let rows = [...(tables[table] ?? [])];
      let limit = Infinity;
      for (const [op, args] of call.ops) {
        const [col, val] = args as [string, unknown];
        if (op === 'eq') rows = rows.filter((r) => r[col] === val);
        if (op === 'neq') rows = rows.filter((r) => r[col] !== val);
        if (op === 'is') rows = rows.filter((r) => (r[col] ?? null) === val);
        if (op === 'in') rows = rows.filter((r) => (val as unknown[]).includes(r[col] ?? false));
        if (op === 'gte') rows = rows.filter((r) => String(r[col]) >= String(val));
        if (op === 'lte') rows = rows.filter((r) => String(r[col]) <= String(val));
        if (op === 'limit') limit = Math.min(limit, Number(col));
      }
      // update: aplica o patch nas linhas filtradas (mesmas referências da tabela).
      const upd = call.ops.find(([op]) => op === 'update');
      if (upd) for (const r of rows) Object.assign(r, upd[1][0] as Row);
      rows = rows.slice(0, limit);
      return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    };
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const res = run();
            return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(res).then(ok, fail);
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args]);
            if (prop === 'maybeSingle' || prop === 'single') single = true;
            return builder;
          };
        },
      },
    );
    return builder;
  };

  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push([name, args]);
    const impl = rpcs[name];
    return impl ? impl(args) : { data: null, error: { message: `rpc ${name} não simulada` } };
  };

  /** Alguma operação de escrita foi chamada? */
  const writes = () => calls.flatMap((c) => c.ops.filter(([op]) => ['insert', 'update', 'upsert', 'delete'].includes(op)).map(([op]) => `${c.table}.${op}`));

  return { db: { from, rpc } as never, calls, rpcCalls, writes };
}
