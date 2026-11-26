// ---------------------------------------------------------------
// Venda de ingressos — espelha supabase/migrations/0006_ticketing.sql
// ---------------------------------------------------------------

export type TicketType = 'pista' | 'vip' | 'camarote' | 'meia' | 'outro';
export type BatchStatus = 'active' | 'paused' | 'closed';
/** Estado calculado no banco (public.batch_stock). */
export type BatchState = 'on_sale' | 'sold_out' | 'reserved_out' | 'ended' | 'closed' | 'paused' | 'upcoming' | 'waiting';
export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'charged_back';
export type TicketStatus = 'valid' | 'used' | 'cancelled';
export type VipStatus = 'pending' | 'approved' | 'rejected';

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  pista: 'Pista',
  vip: 'VIP',
  camarote: 'Camarote',
  meia: 'Meia-entrada',
  outro: 'Outro',
};

export const BATCH_STATE_LABEL: Record<BatchState, string> = {
  on_sale: 'À venda',
  sold_out: 'Esgotado',
  reserved_out: 'Reservado — pode voltar',
  ended: 'Encerrado',
  closed: 'Encerrado',
  paused: 'Pausado',
  upcoming: 'Em breve',
  waiting: 'Próximo lote',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Aguardando pagamento',
  paid: 'Pago',
  expired: 'Expirado',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
  charged_back: 'Contestado (chargeback)',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  bank_transfer: 'Pix',
  pix: 'Pix',
  card: 'Cartão de crédito',
  // Pedidos antigos do Mercado Pago:
  ticket: 'Boleto',
  account_money: 'Saldo Mercado Pago',
};

/** Lote como o público vê (preço/estoque podem vir null quando ocultos). */
export interface PublicBatch {
  batch_id: string;
  ticket_type: TicketType;
  name: string;
  price: number | null;
  available: number | null;
  sales_start: string | null;
  sales_end: string | null;
  state: BatchState;
  max_per_order: number;
  /** Vendas bloqueadas (preço oculto ou evento passado). */
  sales_locked: boolean;
}

/** Lote completo (painel do produtor). */
export interface TicketBatch {
  id: string;
  event_id: string;
  name: string;
  ticket_type: TicketType;
  price: number;
  quantity: number;
  sort_order: number;
  sales_start: string | null;
  sales_end: string | null;
  status: BatchStatus;
  max_per_order: number;
  created_at: string;
}

export interface BatchStock {
  batch_id: string;
  ticket_type: TicketType;
  name: string;
  price: number;
  quantity: number;
  sold: number;
  reserved: number;
  available: number;
  sales_start: string | null;
  sales_end: string | null;
  status: BatchStatus;
  sort_order: number;
  max_per_order: number;
  state: BatchState;
}

export interface BuyerInfo {
  name: string;
  cpf: string;
  email: string;
  phone: string;
}

export interface CartItem {
  batch_id: string;
  quantity: number;
}

export interface Order {
  id: string;
  event_id: string;
  user_id: string;
  buyer_name: string;
  buyer_cpf: string;
  buyer_email: string;
  buyer_phone: string;
  status: OrderStatus;
  total: number;
  expires_at: string;
  payment_method: string | null;
  installments: number | null;
  /** Pedidos antigos (Mercado Pago). */
  mp_payment_id: string | null;
  provider: 'mercadopago' | 'purincash' | null;
  /** Cobrança atual: psc_... (Pix) ou orderCode (cartão) no PurinCash. */
  provider_payment_id: string | null;
  provider_method: 'pix' | 'card' | null;
  paid_at: string | null;
  created_at: string;
}

export interface OrderItemRow {
  id: string;
  batch_id: string;
  quantity: number;
  unit_price: number;
  batch?: { name: string; ticket_type: TicketType } | null;
}

export interface Ticket {
  id: string;
  order_id: string;
  event_id: string;
  batch_id: string;
  holder_name: string;
  code: string;
  status: TicketStatus;
  used_at: string | null;
  created_at: string;
}

export interface VipEntry {
  id: string;
  event_id: string;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  note: string;
  status: VipStatus;
  source: 'manual' | 'csv' | 'link';
  checked_in_at: string | null;
  created_at: string;
}

export interface VipLink {
  id: string;
  event_id: string;
  token: string;
  max_entries: number | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

export type CheckinResult =
  | { result: 'ok'; holder_name: string; batch: string; ticket_type?: TicketType }
  | { result: 'already_used'; used_at: string; holder_name: string; batch?: string }
  | { result: 'cancelled' | 'not_approved'; holder_name: string }
  | { result: 'not_found' | 'wrong_event' };

export interface AttendeeHit {
  kind: 'ticket' | 'vip';
  id: string;
  name: string;
  cpf: string | null;
  batch: string;
  status: string;
  used_at: string | null;
}

export interface EventDashboard {
  capacity: number | null;
  tickets_sold: number;
  tickets_reserved: number;
  orders_paid: number;
  gross: number;
  fees: number;
  checked_in: number;
  vip_total: number;
  vip_present: number;
  vip_pending: number;
  batches: BatchStock[];
  recent_orders: { id: string; buyer_name: string; total: number; status: OrderStatus; payment_method: string | null; created_at: string; paid_at: string | null }[];
}

export interface EventReport {
  event: { id: string; name: string; event_date: string; start_time: string; capacity: number | null };
  buyers: {
    order_id: string;
    buyer_name: string;
    buyer_cpf: string;
    buyer_email: string;
    buyer_phone: string;
    batch: string;
    ticket_type: TicketType;
    quantity: number;
    unit_price: number;
    amount: number;
    created_at: string;
    paid_at: string | null;
    status: OrderStatus;
    payment_method: string | null;
    installments: number | null;
    checked_in: number;
    tickets: number;
  }[];
  vip: { name: string; cpf: string | null; email: string | null; phone: string | null; note: string; status: VipStatus; source: string; checked_in_at: string | null; created_at: string }[];
  revenue: {
    gross: number;
    fees: number;
    net: number;
    refunded: number;
    by_batch: { batch: string; ticket_type: TicketType; price: number; quantity: number; sold: number; gross: number }[];
    by_method: { method: string; orders: number; tickets: number; gross: number }[];
  };
  checkins: { tickets_used: number; tickets_total: number; vip_present: number; vip_total: number };
}

export interface ProducerEventSummary {
  event_id: string;
  name: string;
  slug: string;
  event_date: string;
  status: string;
  visibility: string;
  capacity: number | null;
  sold: number;
  gross: number;
}

export interface AdminEventRow {
  event_id: string;
  name: string;
  slug: string;
  event_date: string;
  city: string | null;
  status: string;
  visibility: 'hidden' | 'partial' | 'visible';
  hide_price: boolean;
  hide_location: boolean;
  hide_name: boolean;
  hide_capacity: boolean;
  producer_id: string | null;
  producer_username: string | null;
  producer_suspended: boolean;
  capacity: number | null;
  sold: number;
  gross: number;
}

export interface AdminProducerRow {
  id: string;
  username: string;
  full_name: string;
  contact: string | null;
  role: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  events: number;
  sold: number;
  gross: number;
}
