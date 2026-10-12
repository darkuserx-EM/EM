import { connectDatabase } from '../server/database.mjs';
import { hydrateEquipment } from '../server/media.mjs';

const mode = process.argv[2];
if (!['status', 'rollback'].includes(mode)) throw new Error('Uso: node scripts/equipment-media-storage.mjs status|rollback');
if (mode === 'rollback' && (!process.argv.includes('--confirm-stopped') || !process.argv.includes('--confirm-backup'))) {
  throw new Error('Primero detén el portal y verifica una copia completa. La reversión requiere --confirm-stopped --confirm-backup.');
}
const pool = connectDatabase(process.env);
try {
  if (mode === 'status') {
    const [meta] = await pool.query('SELECT revision,schema_version FROM em_meta WHERE id=1');
    const [[files]] = await pool.query('SELECT COUNT(*) AS files,COALESCE(SUM(size),0) AS bytes FROM em_media');
    const [[rows]] = await pool.query("SELECT COUNT(*) AS equipment,COALESCE(SUM(OCTET_LENGTH(payload)),0) AS recordBytes FROM em_records WHERE entity='Equipo'");
    console.log(JSON.stringify({ ...meta[0], ...files, ...rows }));
  } else {
    let cursor = '', recovered = 0;
    for (;;) {
      const [ids] = await pool.execute("SELECT id FROM em_records WHERE entity='Equipo' AND id>? ORDER BY id LIMIT 1", [cursor]);
      if (!ids.length) break;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction(); await conn.query('SELECT id FROM em_meta WHERE id=1 FOR UPDATE');
        const [rows] = await conn.execute("SELECT payload FROM em_records WHERE entity='Equipo' AND id=?", [ids[0].id]);
        if (rows.length) {
          const row = JSON.parse(rows[0].payload);
          const [hydrated] = await hydrateEquipment(conn, [row]);
          if (JSON.stringify(hydrated) !== JSON.stringify(row)) {
            await conn.execute("UPDATE em_records SET payload=? WHERE entity='Equipo' AND id=?", [JSON.stringify(hydrated), row.id]);
            await conn.query('UPDATE em_meta SET revision=revision+1 WHERE id=1'); recovered++;
          }
        }
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      cursor = ids[0].id;
    }
    // Keep schema/tables and retired media. Revert the application only after every current file was restored.
    console.log(JSON.stringify({ recovered, next: 'Publica la versión anterior antes de iniciar el portal. No borres las tablas de fotografías.' }));
  }
} finally { await pool.end(); }
