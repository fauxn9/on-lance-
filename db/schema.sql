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

-- ---------------------------------------------------------------------------
-- Brique 3 : le moteur de statistiques.
--
-- Une seule table d'agrégats, volontairement générique : un compteur de parties
-- et de victoires par (patch, file, champion, rôle, type, clé). Ajouter une
-- statistique = ajouter un `kind`, pas une table. On ne garde AUCUNE partie
-- brute : seulement des compteurs.
--
--   kind       key                                       exemple
--   champ      ''                                        parties jouées sur ce rôle
--   runes      style:4 runes|style:2 runes|3 fragments   8000:8010,9111,9104,8014|8400:8444,8451|5008,5008,5011
--   spells     sorts triés                               4,12
--   start      items de départ triés                     1055,2003
--   boots      bottes                                    3047
--   core       3 premiers items complets, dans l'ordre   3071>3053>6333
--   item       un item complet acheté                    6610
--   skillmax   ordre de montée des compétences           QEW
--   skillstart 3 premiers points                         QWE
--   matchup    champion adverse sur le même poste        122
--   augment    augment choisi (ARAM Mayhem)              123
--
-- champion_id 0, role '*', kind 'matches' : nombre de parties analysées, pour
-- les taux de sélection.
create table if not exists stats (
  patch        text not null,
  queue        int  not null,
  champion_id  int  not null,
  role         text not null,
  kind         text not null,
  key          text not null,
  games        int  not null default 0,
  wins         int  not null default 0,
  primary key (patch, queue, champion_id, role, kind, key)
);
create index if not exists stats_par_type on stats (patch, queue, kind);

-- Parties déjà analysées (pour ne jamais compter deux fois).
create table if not exists crawl_matches (
  match_id   text primary key,
  patch      text,
  queue      int,
  crawled_at timestamptz not null default now()
);

-- Joueurs Émeraude+ dont on suit les parties.
create table if not exists crawl_players (
  puuid           text primary key,
  platform        text not null,
  tier            text,
  added_at        timestamptz not null default now(),
  last_crawled_at timestamptz
);
create index if not exists crawl_players_a_faire on crawl_players (platform, last_crawled_at nulls first);

alter table stats         enable row level security;
alter table crawl_matches enable row level security;
alter table crawl_players enable row level security;

-- Debriefs d'après-partie (brique 7) : calculés une fois par partie et par
-- joueur. `version` : un debrief d'une ancienne version est recalculé.
create table if not exists debriefs (
  match_id   text not null,
  puuid      text not null references accounts(puuid) on delete cascade,
  version    int not null,
  ia         boolean not null default false,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, puuid)
);
create index if not exists debriefs_ia_recents on debriefs (created_at) where ia;
alter table debriefs enable row level security;

-- Entre potes (brique 8) ---------------------------------------------------
-- Un profil = une personne. Tous les comptes LoL reliés depuis la même
-- installation de l'app lui appartiennent (preuve : ils ont été connectés au
-- client League sur ce PC).
create table if not exists profils (
  id           bigint generated always as identity primary key,
  pseudo       text not null,
  installation text unique,          -- empreinte SHA-256 de l'identifiant d'installation
  created_at   timestamptz not null default now()
);
alter table accounts add column if not exists profil_id bigint references profils(id) on delete set null;
create index if not exists accounts_profil on accounts (profil_id);

create table if not exists groupes (
  id              bigint generated always as identity primary key,
  nom             text not null,
  code            text not null unique,  -- code d'invitation
  fuseau          text not null default 'Europe/Paris',
  createur        bigint references profils(id) on delete set null,
  webhook         text,                  -- salon Discord (jamais renvoyé à l'app)
  discord_guild   text,
  discord_salon   text,
  discord_nom     text,
  chambrage       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists groupes_guild on groupes (discord_guild);

create table if not exists groupe_membres (
  groupe_id  bigint not null references groupes(id) on delete cascade,
  profil_id  bigint not null references profils(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (groupe_id, profil_id)
);
create index if not exists groupe_membres_profil on groupe_membres (profil_id);

-- Semaines terminées : classement figé et vainqueur (historique).
create table if not exists groupe_semaines (
  groupe_id  bigint not null references groupes(id) on delete cascade,
  semaine    date not null,
  gagnant    bigint references profils(id) on delete set null,
  classement jsonb not null,
  primary key (groupe_id, semaine)
);

-- Le fil des potes : chambrages de fin de partie, couronnes de la semaine.
create table if not exists evenements (
  id         bigint generated always as identity primary key,
  groupe_id  bigint not null references groupes(id) on delete cascade,
  profil_id  bigint references profils(id) on delete cascade,
  type       text not null,
  cle        text not null,             -- anti-doublon (partie, semaine…)
  texte      text not null,
  data       jsonb not null default '{}',
  ia         boolean not null default false,
  created_at timestamptz not null default now(),
  unique (groupe_id, cle)
);
create index if not exists evenements_fil on evenements (groupe_id, id desc);
create index if not exists evenements_ia on evenements (created_at) where ia;

create table if not exists reactions (
  evenement_id bigint not null references evenements(id) on delete cascade,
  profil_id    bigint not null references profils(id) on delete cascade,
  type         text not null,
  primary key (evenement_id, profil_id)
);

alter table profils enable row level security;
alter table groupes enable row level security;
alter table groupe_membres enable row level security;
alter table groupe_semaines enable row level security;
alter table evenements enable row level security;
alter table reactions enable row level security;
