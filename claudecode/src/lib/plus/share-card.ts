'use client';
/**
 * Gera o card "MINHA NOITE EM {ano}" (1080×1920, formato stories) em canvas.
 * Usa somente os números calculados da conta — nenhum valor é preenchido.
 */
import type { Retrospective } from './retrospective';

const W = 1080;
const H = 1920;

export async function renderShareCard(r: Retrospective, username: string): Promise<Blob> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await Promise.all([document.fonts.load('800 120px "Sora Variable"'), document.fonts.load('600 40px "Manrope Variable"')]);
    } catch {
      /* usa fonte do sistema */
    }
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const display = (size: number, weight = 800) => `${weight} ${size}px "Sora Variable", system-ui, sans-serif`;
  const body = (size: number, weight = 600) => `${weight} ${size}px "Manrope Variable", system-ui, sans-serif`;

  // Fundo preto com iluminação azul discreta
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(W * 0.85, 120, 0, W * 0.85, 120, 900);
  g1.addColorStop(0, 'rgba(131,169,245,0.35)');
  g1.addColorStop(1, 'rgba(131,169,245,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(0, H, 0, 0, H, 800);
  g2.addColorStop(0, 'rgba(131,169,245,0.18)');
  g2.addColorStop(1, 'rgba(131,169,245,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // Moldura
  ctx.strokeStyle = 'rgba(131,169,245,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  const x = 110;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#F5F5F5';
  ctx.font = display(40);
  ctx.fillText('CLASSIFY', x, 190);
  const cw = ctx.measureText('CLASSIFY').width;
  ctx.fillStyle = '#83A9F5';
  ctx.fillText('+', x + cw + 6, 190);

  ctx.fillStyle = '#A0A0A0';
  ctx.font = body(34);
  ctx.fillText(`@${username}`, x, 250);

  ctx.fillStyle = '#F5F5F5';
  ctx.font = display(150);
  ctx.fillText('MINHA', x, 470);
  ctx.fillText('NOITE', x, 620);
  ctx.fillStyle = '#83A9F5';
  ctx.fillText(`EM ${r.year}`, x, 770);

  const stats: [string, string][] = [
    [String(r.venues), r.venues === 1 ? 'casa avaliada' : 'casas avaliadas'],
    [String(r.reviews), r.reviews === 1 ? 'avaliação publicada' : 'avaliações publicadas'],
  ];
  if (r.photos > 0) stats.push([String(r.photos), r.photos === 1 ? 'foto enviada' : 'fotos enviadas']);
  if (r.avgGiven !== null) stats.push([r.avgGiven.toFixed(1), 'nota média que dei']);

  let y = 930;
  for (const [n, label] of stats) {
    ctx.fillStyle = '#83A9F5';
    ctx.font = display(96);
    ctx.fillText(n, x, y);
    const nw = ctx.measureText(n).width;
    ctx.fillStyle = '#F5F5F5';
    ctx.font = body(40);
    ctx.fillText(label, x + nw + 30, y - 12);
    y += 130;
  }

  const lines: [string, string][] = [];
  if (r.favoriteStyle) lines.push(['MEU ESTILO FAVORITO', r.favoriteStyle.style]);
  if (r.topVenue) lines.push(['MINHA CASA Nº 1', r.topVenue.venue.name]);
  y += 20;
  for (const [label, value] of lines) {
    ctx.fillStyle = '#A0A0A0';
    ctx.font = body(28, 700);
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#F5F5F5';
    ctx.font = display(64);
    let text = value.toUpperCase();
    while (ctx.measureText(text).width > W - 2 * x && text.length > 4) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, x, y + 76);
    y += 170;
  }

  ctx.fillStyle = '#A0A0A0';
  ctx.font = body(30);
  ctx.fillText('classifydj · We rate the night.', x, H - 120);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/png'));
}
