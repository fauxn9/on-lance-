-- On lance ? — schéma de la base (Supabase / Postgres)
--
-- Brique 2 : comptes, appareils, historique des parties, rang.
--
-- RLS est activé partout SANS politique, volontairement (même choix que le
-- projet Valorant) : le serveur passe par le rôle `postgres`, qui ignore RLS,
-- tandis que la clé publique `anon` de Supabase ne voit plus aucune ligne. Les
-- règles d'accès vivent à un seul endroit, l'API, où elles sont testées.

-- Un compte Riot suivi. La plateforme (euw1, na1…) décide de la route à
-- prendre vers l'API Riot.
create table if not exists accounts (
  puuid            text primary key,
  platform         text not null,
  game_name        text not null,
  tag_line         text not null,
  profile_icon_id  int,
  summoner_level   int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Synchronisation : la plus récente partie connue (pour aller chercher les
  -- nouvelles) et le curseur du rattrapage, qui remonte le temps.
  newest_game_start bigint,
  backfill_before   bigint,
  backfill_done     boolean not null default false,
  last_sync_at      timestamptz
);

-- Un appareil = une installation de l'app pour un compte. Le jeton n'est
-- jamais stocké en clair : seulement son empreinte SHA-256.
create table if not exists devices (
  id           bigint generated always as identity primary key,
  token_hash   text not null unique,
  puuid        text not null references accounts(puuid) on delete cascade,
  app_version  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists devices_puuid on devices (puuid);

-- Une partie vue par UN joueur suivi. On ne garde pas les 9 autres : ce qui
-- sert à l'historique tient dans une ligne, et la base reste petite.
create table if not exists player_matches (
  match_id        text not null,
  puuid           text not null references accounts(puuid) on delete cascade,
  queue_id        int not null,
  game_start      bigint not null,            -- ms depuis l'epoch
  duration_s      int not null,
  game_version    text,
  remake          boolean not null default false,
  champion_id     int not null,
  champion_name   text not null,
  team_position   text,
  win             boolean not null,
  kills           int not null default 0,
  deaths          int not null default 0,
  assists         int not null default 0,
  cs              int not null default 0,
  gold            int not null default 0,
  damage          int not null default 0,
  vision          int not null default 0,
  champ_level     int,
  items           int[] not null default '{}',
  spells          int[] not null default '{}',
  keystone        int,
  secondary_style int,
  primary key (match_id, puuid)
);
create index if not exists player_matches_history on player_matches (puuid, game_start desc);

-- Variation de PL d'une partie, mesurée par l'app sur le client (avant/après).
-- Séparée des parties : l'app la connaît dès la fin de partie, alors que Riot
-- ne publie la partie que quelques minutes plus tard.
create table if not exists lp_changes (
  puuid      text not null references accounts(puuid) on delete cascade,
  match_id   text not null,
  queue      text not null,
  delta      int not null,
  lp_after   int,
  tier_after text,
  division_after text,
  created_at timestamptz not null default now(),
  primary key (puuid, match_id)
);

-- Photos du rang, prises à chaque synchronisation quand quelque chose a bougé.
create table if not exists rank_snapshots (
  id        bigint generated always as identity primary key,
  puuid     text not null references accounts(puuid) on delete cascade,
  queue     text not null,                    -- RANKED_SOLO_5x5, RANKED_FLEX_SR
  tier      text not null,
  division  text,
  lp        int not null,
  wins      int not null,
  losses    int not null,
  taken_at  timestamptz not null default now()
);
create index if not exists rank_snapshots_recent on rank_snapshots (puuid, queue, taken_at desc);

alter table accounts       enable row level security;
alter table devices        enable row level security;
alter table player_matches enable row level security;
alter table lp_changes     enable row level security;
alter table rank_snapshots enable row level security;
