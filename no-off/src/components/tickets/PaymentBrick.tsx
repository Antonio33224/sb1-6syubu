'use client';
/**
 * Payment Brick do Mercado Pago (Pix, cartão de crédito com parcelamento e boleto).
 * Os dados do cartão ficam nos campos seguros do MP (iframes) — o NO OFF recebe
 * só um token. O valor exibido é o total do pedido; o servidor cobra o total do banco.
 */
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts?: { locale?: string }) => {
      bricks: () => {
        create: (kind: 'payment', containerId: string, settings: Record<string, unknown>) => Promise<{ unmount: () => void }>;
      };
    };
  }
}

const SDK_URL = 'https://sdk.mercadopago.com/js/v2';
let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.MercadoPago) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('Não foi possível carregar o Mercado Pago.'));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export interface BrickPayer {
  email: string;
  firstName: string;
  lastName: string;
  cpf: string;
}

export function PaymentBrick({
  amount,
  payer,
  onSubmit,
}: {
  amount: number;
  payer: BrickPayer;
  /** Recebe o formData do Brick; deve resolver quando o servidor responder. */
  onSubmit: (formData: Record<string, unknown>) => Promise<void>;
}) {
  const id = useRef(`mp-brick-${Math.random().toString(36).slice(2)}`).current;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;

  useEffect(() => {
    if (!publicKey) {
      setError('Pagamentos não configurados (NEXT_PUBLIC_MP_PUBLIC_KEY).');
      return;
    }
    let controller: { unmount: () => void } | null = null;
    let cancelled = false;
    loadSdk()
      .then(async () => {
        if (cancelled || !window.MercadoPago) return;
        const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
        controller = await mp.bricks().create('payment', id, {
          initialization: {
            amount,
            payer: {
              email: payer.email,
              firstName: payer.firstName,
              lastName: payer.lastName,
              identification: { type: 'CPF', number: payer.cpf },
            },
          },
          customization: {
            paymentMethods: { creditCard: 'all', bankTransfer: ['pix'], ticket: 'all', maxInstallments: 12 },
            visual: {
              style: {
                theme: 'dark',
                customVariables: { baseColor: '#E10600', baseColorFirstVariant: '#FF3B30', baseColorSecondVariant: '#B00500', formBackgroundColor: '#111111', outlinePrimaryColor: '#292929' },
              },
            },
          },
          callbacks: {
            onReady: () => !cancelled && setReady(true),
            onError: (e: unknown) => {
              console.error('[mp-brick]', e);
            },
            onSubmit: ({ formData }: { selectedPaymentMethod: string; formData: Record<string, unknown> }) => submitRef.current(formData),
          },
        });
        if (cancelled) controller.unmount();
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Falha ao carregar o pagamento.'));
    return () => {
      cancelled = true;
      controller?.unmount();
    };
    // O Brick é recriado somente se o valor mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, publicKey]);

  return (
    <div>
      {error && <p role="alert" className="rounded-card border border-red/40 bg-red-soft px-4 py-3 text-[13px]">{error}</p>}
      {!ready && !error && <div className="h-[420px] animate-pulse rounded-card border border-line bg-panel" aria-label="Carregando pagamento" />}
      <div id={id} />
    </div>
  );
}
