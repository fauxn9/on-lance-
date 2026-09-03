-- "On lance ?" — schema Brique 1 (detection de match + notif de fin de partie)
-- Cible : Postgres (Supabase free tier en dev comme en prod pour demarrer).
--
-- Les tables des Briques 2 et 3 (leaderboard hebdo, insights positionnels) sont
-- volontairement absentes : elles arrivent quand la Brique 1 tourne pour de vrai.

-- L'identite vient de Discord (Brique 4). discord_id est nullable : les profils
-- crees avant l'authentification n'en ont pas, et ce sont eux qui seront adoptes
-- quand leur proprietaire reclamera son Riot ID.
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  display_name     TEXT        NOT NULL,
  discord_id       TEXT UNIQUE,
  discord_username TEXT,
  avatar_url       TEXT,
  last_seen_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  -- code court, lisible, affiche dans l'interface
  join_code     TEXT        NOT NULL UNIQUE,
  -- jeton long et imprevisible : c'est LUI qui protege le groupe. Sans le lien
  -- d'invitation, on ne peut pas rejoindre le groupe de quelqu'un d'autre.
  invite_token  TEXT        NOT NULL,
  owner_user_id BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_invite_token ON groups(invite_token);

CREATE TABLE IF NOT EXISTS memberships (
  group_id   BIGINT      NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Un compte Riot lie a un user. Le puuid est la vraie cle de jointure cote API :
-- le couple name#tag peut changer, le puuid non.
CREATE TABLE IF NOT EXISTS linked_riot_accounts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puuid       TEXT        NOT NULL UNIQUE,
  riot_name   TEXT        NOT NULL,
  riot_tag    TEXT        NOT NULL,
  region      TEXT        NOT NULL DEFAULT 'eu',
  -- Preuve de possession. Reste false partout aujourd'hui : saisir un Riot ID
  -- ne prouve pas qu'il est a vous. L'app desktop (Brique 9) lira le lockfile
  -- du client Valorant, qui expose le compte reellement connecte sur la
  -- machine, et pourra basculer ce champ a true.
  verified    BOOLEAN     NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_user ON linked_riot_accounts(user_id);

-- Anti-doublon de notif : un match_id n'est traite qu'une seule fois par groupe.
-- La contrainte UNIQUE est la garantie dure — meme si deux crons se chevauchent,
-- le second INSERT echoue et le match n'est pas re-notifie.
CREATE TABLE IF NOT EXISTS detected_matches (
  id            BIGSERIAL PRIMARY KEY,
  group_id      BIGINT      NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id      TEXT        NOT NULL,
  map_name      TEXT,
  mode          TEXT,
  started_at    TIMESTAMPTZ,
  -- snapshot du classement du groupe sur ce match (JSON), pour pouvoir
  -- re-afficher l'historique sans retaper l'API
  standings     JSONB       NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_detected_group_time ON detected_matches(group_id, processed_at DESC);

-- File de notifications. On ecrit d'abord en base, on envoie ensuite :
-- si l'envoi plante, le message n'est pas perdu et le cron suivant le reprend.
CREATE TABLE IF NOT EXISTS notifications (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detected_match_id   BIGINT      NOT NULL REFERENCES detected_matches(id) ON DELETE CASCADE,
  tone                TEXT        NOT NULL CHECK (tone IN ('hype', 'push', 'roast')),
  rank_in_group       INT         NOT NULL,
  body                TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'sent', 'failed')),
  attempts            INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications(status, created_at)
  WHERE status = 'pending';

-- Abonnements Web Push (un user peut avoir plusieurs appareils/navigateurs).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT        NOT NULL UNIQUE,
  keys        JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Brique 2 — leaderboard hebdomadaire (RR gagne sur la semaine, reset lundi)
-- ===========================================================================

-- Une ligne par joueur et par match classe : le RR gagne/perdu sur ce match.
-- On stocke le detail match par match plutot qu'un total par semaine, pour
-- pouvoir recalculer/corriger un classement sans rien perdre, et parce que
-- l'API nous donne deja cette granularite (champ last_change).
CREATE TABLE IF NOT EXISTS match_rr (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puuid       TEXT        NOT NULL,
  match_id    TEXT        NOT NULL,
  rr_change   INT         NOT NULL,
  rr_after    INT,
  tier        TEXT,
  map_name    TEXT,
  played_at   TIMESTAMPTZ NOT NULL,
  -- lundi de la semaine concernee (fuseau du groupe), calcule cote code :
  -- le stocker evite de refaire un calcul de fuseau dans chaque requete SQL.
  week_start  DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Garantie dure contre le double comptage : le cron repasse sur les memes
  -- matchs a chaque execution, seul le premier INSERT gagne.
  UNIQUE (puuid, match_id)
);

CREATE INDEX IF NOT EXISTS idx_match_rr_week ON match_rr(week_start, user_id);
CREATE INDEX IF NOT EXISTS idx_match_rr_user_time ON match_rr(user_id, played_at DESC);

-- Historique des vainqueurs : le classement est fige au moment de la cloture.
-- On ne le recalcule jamais a l'affichage, sinon un membre qui quitte le groupe
-- reecrirait le passe.
CREATE TABLE IF NOT EXISTS weekly_winners (
  id              BIGSERIAL   PRIMARY KEY,
  group_id        BIGINT      NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  week_start      DATE        NOT NULL,
  winner_user_id  BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  winner_name     TEXT,
  winner_rr       INT,
  standings       JSONB       NOT NULL,
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Meme logique que detected_matches : une semaine ne se cloture qu'une fois.
  UNIQUE (group_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_winners_group ON weekly_winners(group_id, week_start DESC);

-- --- Adaptations de la table notifications pour la Brique 2 -----------------
-- Les notifs de fin de semaine ne sont rattachees a aucun match : la colonne
-- detected_match_id devient optionnelle et une colonne `kind` distingue les
-- deux familles de notifs.
ALTER TABLE notifications ALTER COLUMN detected_match_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'match';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS week_start DATE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('match', 'weekly'));

-- 'crown' = vainqueur de la semaine, 'recap' = les autres membres du groupe.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_tone_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_tone_check
  CHECK (tone IN ('hype', 'push', 'roast', 'crown', 'recap'));

-- ===========================================================================
-- Brique 3 — coach positionnel
-- ===========================================================================

-- Une ligne par mort d'un joueur SUIVI (membre d'un groupe), avec les metriques
-- deja calculees par positional.js.
--
-- Volume : un match genere ~150 evenements de kill, mais on ne garde que les
-- morts des joueurs suivis, soit ~20 lignes par joueur et par match. A raison
-- de 20 matchs par semaine, ca fait 400 lignes par joueur et par semaine —
-- negligeable, la ou stocker tous les evenements bruts aurait explose.
--
-- On stocke a la fois les coordonnees de jeu (loc_x/loc_y, la donnee de
-- reference) et les coordonnees minimap (mini_x/mini_y, deja converties pour
-- l'affichage). Si la calibration d'une map change ou manque, la conversion
-- reste refaisable a partir des coordonnees de jeu.
CREATE TABLE IF NOT EXISTS player_deaths (
  id                 BIGSERIAL   PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puuid              TEXT        NOT NULL,
  match_id           TEXT        NOT NULL,
  round              INT         NOT NULL,
  played_at          TIMESTAMPTZ NOT NULL,
  map_name           TEXT,
  agent              TEXT,
  weapon             TEXT,

  loc_x              INT         NOT NULL,
  loc_y              INT         NOT NULL,
  mini_x             REAL,
  mini_y             REAL,

  duel_distance_m    REAL,
  nearest_teammate_m REAL,       -- NULL = dernier en vie, pas une donnee manquante
  living_teammates   INT         NOT NULL DEFAULT 0,
  last_alive         BOOLEAN     NOT NULL DEFAULT false,
  isolated           BOOLEAN     NOT NULL DEFAULT false,
  trade_possible     BOOLEAN     NOT NULL DEFAULT false,

  -- Angle de regard : renseigne uniquement quand il a pu etre reconstitue avec
  -- un ecart de temps assez faible (voir positional.js). NULL = inconnu, ce qui
  -- est le cas le plus frequent et doit le rester.
  view_delta_deg     REAL,
  view_gap_ms        INT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un joueur ne meurt qu'une fois par round : cle naturelle et anti-doublon.
  UNIQUE (puuid, match_id, round)
);

CREATE INDEX IF NOT EXISTS idx_deaths_user_time ON player_deaths(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_deaths_user_map ON player_deaths(user_id, map_name);

-- Resume d'un match du point de vue d'un joueur suivi : c'est la source de
-- l'historique affiche dans le dashboard.
--
-- Pourquoi une table dediee alors que detected_matches existe deja : cette
-- derniere ne contient que les parties jouees A PLUSIEURS du meme groupe. Un
-- joueur veut voir toutes ses parties, y compris celles jouees seul.
-- Et match_rr, lui, n'a que le RR — ni score, ni agent, ni K/D.
CREATE TABLE IF NOT EXISTS player_matches (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puuid         TEXT        NOT NULL,
  match_id      TEXT        NOT NULL,
  played_at     TIMESTAMPTZ NOT NULL,
  map_name      TEXT,
  mode          TEXT,
  agent         TEXT,
  rounds_played INT,
  score         INT,
  acs           INT,
  kills         INT,
  deaths        INT,
  assists       INT,
  headshot_pct  INT,
  damage_dealt  INT,
  won           BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (puuid, match_id)
);

CREATE INDEX IF NOT EXISTS idx_player_matches_user_time
  ON player_matches(user_id, played_at DESC);

-- Matchs deja analyses, pour ne pas re-telecharger et re-analyser en boucle.
CREATE TABLE IF NOT EXISTS analyzed_matches (
  puuid        TEXT        NOT NULL,
  match_id     TEXT        NOT NULL,
  deaths       INT         NOT NULL DEFAULT 0,
  analyzed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (puuid, match_id)
);
