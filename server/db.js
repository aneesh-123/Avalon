require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Save room state — called after every phase transition
async function saveRoom(room) {
  const { error } = await supabase
    .from('rooms')
    .upsert({ code: room.code, state: room, updated_at: new Date().toISOString() });
  if (error) console.error('[db] save failed:', error.message);
}

// Load all rooms created in the last 24 hours on server startup
async function loadRooms() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('rooms')
    .select('state')
    .gte('updated_at', cutoff);
  if (error) { console.error('[db] load failed:', error.message); return []; }
  return data.map(row => {
    const room = row.state;
    // After a server restart all players are effectively disconnected —
    // mark them so the game pauses until everyone reconnects via their tokens
    if (room.state === 'playing') {
      room.disconnected = room.players.map(p => p.name);
    }
    return room;
  });
}

// Remove room when game ends or everyone leaves
async function deleteRoom(code) {
  const { error } = await supabase.from('rooms').delete().eq('code', code);
  if (error) console.error('[db] delete failed:', error.message);
}

module.exports = { saveRoom, loadRooms, deleteRoom };
