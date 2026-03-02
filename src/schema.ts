import pool from "./db";

/**
 * Creates the Contact table if it does not already exist.
 */
export async function initDB(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Contact" (
      id              SERIAL PRIMARY KEY,
      "phoneNumber"   VARCHAR(255),
      email           VARCHAR(255),
      "linkedId"      INTEGER REFERENCES "Contact"(id),
      "linkPrecedence" VARCHAR(10) NOT NULL CHECK ("linkPrecedence" IN ('primary', 'secondary')),
      "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
      "deletedAt"     TIMESTAMP
    );
  `);

  // Indexes for fast lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_email ON "Contact" (email);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_phone ON "Contact" ("phoneNumber");
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_linked ON "Contact" ("linkedId");
  `);
}
