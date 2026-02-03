-- Seed data for development/testing
-- Twitch Live Streaming Platform
-- Password hash is for 'password123': $2b$10$KvyL.xiSRBiXVY1iP4L7B.vghE/SDLNJX2gHIOjaS707KBZnUcIom

-- Insert sample categories (using Unsplash images for game/category art)
INSERT INTO categories (name, slug, image_url) VALUES
  ('Just Chatting', 'just-chatting', 'https://images.unsplash.com/photo-1516321497487-e288fb19713f?w=300'),
  ('Fortnite', 'fortnite', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300'),
  ('League of Legends', 'league-of-legends', 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=300'),
  ('Minecraft', 'minecraft', 'https://images.unsplash.com/photo-1587573088697-b308fa1f96ce?w=300'),
  ('Valorant', 'valorant', 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300'),
  ('Grand Theft Auto V', 'gtav', 'https://images.unsplash.com/photo-1493711662062-fa541f7f3d24?w=300'),
  ('Counter-Strike 2', 'cs2', 'https://images.unsplash.com/photo-1547153760-18fc86324498?w=300'),
  ('Music', 'music', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300'),
  ('Art', 'art', 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=300'),
  ('Software & Game Development', 'software-dev', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=300');

-- Insert global emotes (using emoji characters as placeholder)
INSERT INTO emotes (channel_id, code, image_url, tier, is_global) VALUES
  (NULL, 'Kappa', 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', 0, TRUE),
  (NULL, 'PogChamp', 'https://static-cdn.jtvnw.net/emoticons/v2/88/default/dark/2.0', 0, TRUE),
  (NULL, 'LUL', 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0', 0, TRUE),
  (NULL, 'KEKW', 'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/2x', 0, TRUE),
  (NULL, 'monkaS', 'https://cdn.betterttv.net/emote/56e9f494fff3cc5c35e5287e/2x', 0, TRUE),
  (NULL, 'PepeHands', 'https://cdn.betterttv.net/emote/59f27b3f4ebd8047f54dee29/2x', 0, TRUE),
  (NULL, 'FeelsGoodMan', 'https://cdn.betterttv.net/emote/566c9fc265dbbdab32ec053b/2x', 0, TRUE),
  (NULL, 'FeelsBadMan', 'https://cdn.betterttv.net/emote/566c9edc65dbbdab32ec052b/2x', 0, TRUE),
  (NULL, 'EZ', 'https://cdn.betterttv.net/emote/5590b223b344e2c42a9e28e3/2x', 0, TRUE),
  (NULL, 'OMEGALUL', 'https://cdn.betterttv.net/emote/583089f4737a8e61abb0186b/2x', 0, TRUE);

-- Sample users (password: password123)
INSERT INTO users (username, email, password_hash, display_name, avatar_url, bio) VALUES
  ('shroud', 'shroud@example.com', '$2b$10$KvyL.xiSRBiXVY1iP4L7B.vghE/SDLNJX2gHIOjaS707KBZnUcIom', 'shroud', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'Professional gamer and streamer'),
  ('pokimane', 'pokimane@example.com', '$2b$10$KvyL.xiSRBiXVY1iP4L7B.vghE/SDLNJX2gHIOjaS707KBZnUcIom', 'Pokimane', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', 'Content creator and gamer'),
  ('xqc', 'xqc@example.com', '$2b$10$KvyL.xiSRBiXVY1iP4L7B.vghE/SDLNJX2gHIOjaS707KBZnUcIom', 'xQc', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'Variety streamer'),
  ('ninja', 'ninja@example.com', '$2b$10$KvyL.xiSRBiXVY1iP4L7B.vghE/SDLNJX2gHIOjaS707KBZnUcIom', 'Ninja', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150', 'Gaming and entertainment'),
  ('admin', 'admin@example.com', '$2b$10$KvyL.xiSRBiXVY1iP4L7B.vghE/SDLNJX2gHIOjaS707KBZnUcIom', 'Admin', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 'Platform administrator');

UPDATE users SET role = 'admin' WHERE username = 'admin';

-- Sample channels
INSERT INTO channels (user_id, name, stream_key, title, category_id, follower_count, subscriber_count, is_live, current_viewers) VALUES
  (1, 'shroud', 'sk_shroud_abc123', 'FPS Games with shroud', 7, 9800000, 45000, TRUE, 42000),
  (2, 'pokimane', 'sk_poki_xyz789', 'Just Chatting with Poki', 1, 9200000, 38000, TRUE, 35000),
  (3, 'xqc', 'sk_xqc_123456', 'xQc is LIVE - Variety Gaming', 1, 11000000, 62000, TRUE, 78000),
  (4, 'ninja', 'sk_ninja_abcdef', 'Fortnite Champion', 2, 18000000, 85000, FALSE, 0);
