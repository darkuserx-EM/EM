/** @typedef {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} SqlConnection */

// mysql2's generic is the SQL schema boundary. Expose only the selected columns,
// without RowDataPacket's permissive index signature leaking into callers.
/**
 * @template {object} Row
 * @param {SqlConnection} conn
 * @param {string} statement
 * @param {import('mysql2').ExecuteValues[]} [values]
 * @returns {Promise<Row[]>}
 */
export async function select(conn, statement, values = []) {
  /** @type {typeof conn.execute<(Row & import('mysql2').RowDataPacket)[]>} */
  const execute = conn.execute.bind(conn);
  const [rows] = await execute(statement, values);
  return rows;
}

/** @template {object} Row @param {SqlConnection} conn @param {string} statement @param {import('mysql2').ExecuteValues[]} [values] @returns {Promise<Row[]>} */
export async function selectQuery(conn, statement, values = []) {
  /** @type {typeof conn.query<(Row & import('mysql2').RowDataPacket)[]>} */
  const query = conn.query.bind(conn);
  const [rows] = await query(statement, values);
  return rows;
}

/** @param {SqlConnection} conn @param {string} statement @param {import('mysql2').ExecuteValues[]} [values] */
export async function change(conn, statement, values = []) {
  /** @type {typeof conn.execute<import('mysql2').ResultSetHeader>} */
  const execute = conn.execute.bind(conn);
  const [result] = await execute(statement, values);
  return result;
}
