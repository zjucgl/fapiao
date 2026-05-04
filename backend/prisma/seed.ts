import * as mysql from 'mysql2/promise';
import * as bcrypt from 'bcrypt';

async function main() {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const initialPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
  if (!username || !initialPassword) {
    throw new Error('SUPER_ADMIN_USERNAME or SUPER_ADMIN_INITIAL_PASSWORD missing');
  }

  const connection = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });

  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    if (rows.length > 0) {
      console.log(`super_admin "${username}" already exists, skipping`);
      return;
    }

    const passwordHash = await bcrypt.hash(initialPassword, 10);
    await connection.execute(
      'INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)',
      [username, passwordHash, 'super_admin', 1],
    );
    console.log(`super_admin "${username}" created (must change password on first login)`);
  } finally {
    await connection.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
