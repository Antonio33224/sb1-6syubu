/**
 * Gera supabase/seed.sql a partir da mesma fonte de dados demonstrativos
 * usada no modo demo (src/data/demo-seed.ts). Todos os registros saem com
 * is_demo = true e podem ser removidos com `select public.remove_demo_data();`.
 *
 *   npm run db:seed-sql
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDemoDatabase } from '../src/data/demo-seed';
import { DEMO_BENEFITS } from '../src/data/plus-demo';

const db = buildDemoDatabase();

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? `array[${v.map(q).join(',')}]::text[]` : `'{}'::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const out: string[] = [
  '-- =====================================================================',
  '-- CLASSIFY DJ — DADOS DE DEMONSTRAÇÃO (fictícios, is_demo = true)',
  `-- Gerado em ${db.seeded_at} por scripts/generate-seed-sql.ts`,
  '-- Remover: select public.remove_demo_data();',
  '-- =====================================================================',
  'begin;',
  '',
];

// Usuários demo (somente as 2 contas de teste têm senha; as demais não conseguem entrar)
const creds = new Map(db.credentialSeeds.map((c) => [c.user_id, c]));
for (const p of db.profiles) {
  const c = creds.get(p.id);
  const email = c?.email ?? `${p.username}@demo.classifydj.invalid`;
  const pw = c ? `crypt(${q(c.password)}, gen_salt('bf'))` : `''`;
  out.push(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', ${q(p.id)}, 'authenticated', 'authenticated', ${q(email)}, ${pw}, now(), '{"provider":"email","providers":["email"],"demo":true}', ${q(JSON.stringify({ username: p.username, full_name: p.full_name }))}, ${q(p.created_at)}, ${q(p.created_at)}, '', '', '', '')
on conflict (id) do nothing;`,
  );
  if (c)
    out.push(
      `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), ${q(p.id)}, ${q(p.id)}, ${q(JSON.stringify({ sub: p.id, email }))}::jsonb, 'email', now(), now(), now())
on conflict do nothing;`,
    );
  out.push(
    `update public.profiles set username = ${q(p.username)}, full_name = ${q(p.full_name)}, city = ${q(p.city)}, bio = ${q(p.bio)}, role = ${q(p.role)}, is_demo = true, created_at = ${q(p.created_at)} where id = ${q(p.id)};`,
  );
}
out.push('');

for (const v of db.venues)
  out.push(
    `insert into public.venues (id, name, slug, description, category, city, state, neighborhood, address, latitude, longitude, cover_image, gallery, instagram_url, website_url, price_range, avg_price, entry_price_min, entry_price_max, drink_price_min, drink_price_max, spend_min, spend_max, music_styles, opening_days, audience_tags, capacity, opens_at, closes_at, is_indicated, is_demo, created_at) values (${[
      v.id, v.name, v.slug, v.description, v.category, v.city, v.state, v.neighborhood, v.address, v.latitude, v.longitude,
      v.cover_image, v.gallery, v.instagram_url, v.website_url, v.price_range, v.avg_price, v.entry_price_min, v.entry_price_max,
      v.drink_price_min, v.drink_price_max, v.spend_min, v.spend_max, v.music_styles, v.opening_days,
      v.audience_tags ?? [], v.capacity ?? null, v.opens_at ?? null, v.closes_at ?? null, v.is_indicated ?? false, true, v.created_at,
    ].map(q).join(', ')}) on conflict (id) do nothing;`,
  );
out.push('');

for (const r of db.reviews)
  out.push(
    `insert into public.venue_reviews (id, user_id, venue_id, music_rating, crowd_rating, atmosphere_rating, drinks_rating, service_rating, organization_rating, experience_rating, comment, experience_date, photos, status, is_demo, created_at, updated_at) values (${[
      r.id, r.user_id, r.venue_id, r.music_rating, r.crowd_rating, r.atmosphere_rating, r.drinks_rating, r.service_rating,
      r.organization_rating, r.experience_rating, r.comment, r.experience_date, r.photos, r.status, true, r.created_at, r.updated_at,
    ].map(q).join(', ')}) on conflict (id) do nothing;`,
  );
out.push('');

for (const l of db.likes)
  out.push(`insert into public.review_likes (id, user_id, review_id, created_at) values (${[l.id, l.user_id, l.review_id, l.created_at].map(q).join(', ')}) on conflict do nothing;`);
out.push('');

for (const e of db.events)
  out.push(
    `insert into public.events (id, venue_id, name, slug, description, cover_image, event_date, start_time, ticket_price, ticket_url, dj_names, music_styles, is_demo, created_at) values (${[
      e.id, e.venue_id, e.name, e.slug, e.description, e.cover_image, e.event_date, e.start_time, e.ticket_price, e.ticket_url,
      e.dj_names, e.music_styles, true, e.created_at,
    ].map(q).join(', ')}) on conflict (id) do nothing;`,
  );
for (const r of db.eventReviews)
  out.push(`insert into public.event_reviews (id, user_id, event_id, rating, comment, is_demo, created_at) values (${[r.id, r.user_id, r.event_id, r.rating, r.comment, true, r.created_at].map(q).join(', ')}) on conflict do nothing;`);
for (const f of db.favorites)
  out.push(`insert into public.favorites (id, user_id, venue_id, event_id, created_at) values (${[f.id, f.user_id, f.venue_id, f.event_id, f.created_at].map(q).join(', ')}) on conflict do nothing;`);
for (const r of db.reports)
  out.push(`insert into public.review_reports (id, user_id, review_id, reason, status, created_at) values (${[r.id, r.user_id, r.review_id, r.reason, r.status, r.created_at].map(q).join(', ')}) on conflict do nothing;`);

// Benefícios Classify+ DEMONSTRATIVOS (is_demo = true → exibidos como "Exemplo", não resgatáveis no Supabase)
const bySlug = new Map(db.venues.map((v) => [v.slug, v]));
DEMO_BENEFITS.forEach((b, i) => {
  const v = bySlug.get(b.venueSlug);
  if (!v) return;
  const id = `00000000-0000-4000-8000-${(9_000_000 + i + 1).toString(16).padStart(12, '0')}`;
  const values = [
    ...[id, v.id, b.title, b.description, b.rules, b.how_to_redeem, v.cover_image].map(q),
    `(current_date + ${Number(b.validDays)})`, // validade relativa à data de execução do seed
    ...[b.total_quantity, true, true].map(q),
  ];
  out.push(
    `insert into public.premium_benefits (id, venue_id, title, description, rules, how_to_redeem, image_url, valid_until, total_quantity, active, is_demo) values (${values.join(', ')}) on conflict (id) do nothing;`,
  );
});

out.push('', 'select public.refresh_venue_approved(id) from public.venues;', 'commit;', '');

const file = join(process.cwd(), 'supabase', 'seed.sql');
writeFileSync(file, out.join('\n'), 'utf8');
console.log(`seed.sql gerado: ${db.profiles.length} usuários, ${db.venues.length} locais, ${db.reviews.length} avaliações, ${db.likes.length} curtidas, ${db.events.length} eventos.`);
