'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Venue, VenueStats } from '@/types';

/** Mapa escuro (OpenStreetMap em P&B invertido) com marcadores minimalistas. */
export function VenueMap({ venues, stats, className, zoom }: { venues: Venue[]; stats?: Record<string, VenueStats>; className?: string; zoom?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
        // Tiles OpenStreetMap com tratamento P&B escuro via CSS (.map-tiles em globals.css).
        // Para alto volume em produção, troque por um provedor de tiles com chave própria.
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
          className: 'map-tiles',
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const map = mapRef.current;
      const layer = layerRef.current!;
      layer.clearLayers();
      const points = venues.filter((v) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude) && v.latitude !== 0);
      points.forEach((v) => {
        const s = stats?.[v.id];
        const score = s?.review_count ? s.avg_rating.toFixed(1) : '—';
        const icon = L.divIcon({
          className: '',
          html: `<div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-100%);white-space:nowrap">
            <span style="background:#050505;border:1px solid #83A9F5;color:#83A9F5;font:700 12px var(--font-display),sans-serif;padding:4px 8px;border-radius:999px">${score}</span></div>`,
          iconSize: [0, 0],
        });
        L.marker([v.latitude, v.longitude], { icon })
          .bindPopup(
            `<div style="min-width:160px"><p style="font:700 13px var(--font-display),sans-serif;text-transform:uppercase;margin:0">${escapeHtml(v.name)}</p>
             <p style="color:#A0A0A0;font-size:11px;margin:4px 0 8px">${escapeHtml(v.neighborhood)} · ${escapeHtml(v.city)}</p>
             <a href="/boates/${v.slug}" style="color:#83A9F5;font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase">Ver página →</a></div>`,
          )
          .addTo(layer);
      });
      if (points.length === 1) map.setView([points[0]!.latitude, points[0]!.longitude], zoom ?? 15);
      else if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude])), { padding: [40, 40], maxZoom: 13 });
      else map.setView([-22.9068, -43.1729], 11);
    })();
    return () => {
      cancelled = true;
    };
  }, [venues, stats, zoom]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return <div ref={el} className={className ?? 'h-[480px] w-full rounded-card border border-line'} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
