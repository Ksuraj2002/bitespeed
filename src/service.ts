import pool from "./db";
import { Contact, IdentifyRequest, IdentifyResponse } from "./types";

// ── helpers ──────────────────────────────────────────────────────────────────

function mapRow(row: any): Contact {
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    email: row.email,
    linkedId: row.linkedId,
    linkPrecedence: row.linkPrecedence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/**
 * Fetch all contacts matching the given email or phoneNumber.
 */
async function findMatchingContacts(
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<Contact[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (email) {
    conditions.push(`email = $${idx++}`);
    values.push(email);
  }
  if (phoneNumber) {
    conditions.push(`"phoneNumber" = $${idx++}`);
    values.push(phoneNumber);
  }

  if (conditions.length === 0) return [];

  const sql = `
    SELECT id, "phoneNumber" AS "phoneNumber", email,
           "linkedId" AS "linkedId",
           "linkPrecedence" AS "linkPrecedence",
           "createdAt" AS "createdAt",
           "updatedAt" AS "updatedAt",
           "deletedAt" AS "deletedAt"
    FROM "Contact"
    WHERE "deletedAt" IS NULL AND (${conditions.join(" OR ")})
  `;
  const { rows } = await pool.query(sql, values);
  return rows.map(mapRow);
}

/**
 * Given a set of root primary IDs, fetch the entire cluster
 * (the primaries themselves + every secondary that points at them).
 */
async function fetchCluster(primaryIds: number[]): Promise<Contact[]> {
  if (primaryIds.length === 0) return [];

  const sql = `
    SELECT id, "phoneNumber" AS "phoneNumber", email,
           "linkedId" AS "linkedId",
           "linkPrecedence" AS "linkPrecedence",
           "createdAt" AS "createdAt",
           "updatedAt" AS "updatedAt",
           "deletedAt" AS "deletedAt"
    FROM "Contact"
    WHERE "deletedAt" IS NULL
      AND (id = ANY($1) OR "linkedId" = ANY($1))
    ORDER BY "createdAt" ASC, id ASC
  `;
  const { rows } = await pool.query(sql, [primaryIds]);
  return rows.map(mapRow);
}

async function insertContact(
  email: string | null,
  phoneNumber: string | null,
  linkedId: number | null,
  linkPrecedence: "primary" | "secondary"
): Promise<Contact> {
  const sql = `
    INSERT INTO "Contact" ("phoneNumber", email, "linkedId", "linkPrecedence", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING id, "phoneNumber" AS "phoneNumber", email,
              "linkedId" AS "linkedId",
              "linkPrecedence" AS "linkPrecedence",
              "createdAt" AS "createdAt",
              "updatedAt" AS "updatedAt",
              "deletedAt" AS "deletedAt"
  `;
  const { rows } = await pool.query(sql, [
    phoneNumber,
    email,
    linkedId,
    linkPrecedence,
  ]);
  return mapRow(rows[0]);
}

async function updateToSecondary(
  contactId: number,
  newLinkedId: number
): Promise<void> {
  await pool.query(
    `UPDATE "Contact"
     SET "linkPrecedence" = 'secondary',
         "linkedId" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [newLinkedId, contactId]
  );
}

// ── main service ─────────────────────────────────────────────────────────────

export async function identify(
  req: IdentifyRequest
): Promise<IdentifyResponse> {
  const email = req.email ?? null;
  const phoneNumber = req.phoneNumber ?? null;

  // Must provide at least one
  if (!email && !phoneNumber) {
    throw new Error("At least one of email or phoneNumber must be provided");
  }

  // ── Step 1: Initial query ──────────────────────────────────────────────────
  const initialMatches = await findMatchingContacts(email, phoneNumber);

  // ── Scenario 1: Brand new customer ─────────────────────────────────────────
  if (initialMatches.length === 0) {
    const newContact = await insertContact(email, phoneNumber, null, "primary");
    return formatResponse([newContact]);
  }

  // ── Step 2: Gather the full cluster ────────────────────────────────────────
  // Find root primary IDs from initial matches
  const rootPrimaryIds = new Set<number>();
  for (const c of initialMatches) {
    if (c.linkPrecedence === "primary") {
      rootPrimaryIds.add(c.id);
    }
    if (c.linkedId !== null) {
      rootPrimaryIds.add(c.linkedId);
    }
  }

  let cluster = await fetchCluster(Array.from(rootPrimaryIds));

  // ── Step 3: Sort & identify the true primary ──────────────────────────────
  cluster.sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id - b.id;
  });
  const truePrimary = cluster[0];

  // ── Step 4 (Scenario 4): Merge – demote other primaries ──────────────────
  for (const c of cluster) {
    if (
      c.linkPrecedence === "primary" &&
      c.id !== truePrimary.id
    ) {
      // Demote this primary to secondary
      await updateToSecondary(c.id, truePrimary.id);
      c.linkPrecedence = "secondary";
      c.linkedId = truePrimary.id;

      // Also re-point any secondaries that were linked to this old primary
      await pool.query(
        `UPDATE "Contact"
         SET "linkedId" = $1, "updatedAt" = NOW()
         WHERE "linkedId" = $2 AND "deletedAt" IS NULL`,
        [truePrimary.id, c.id]
      );
    }
  }

  // Refresh cluster after merges so everything is consistent
  cluster = await fetchCluster([truePrimary.id]);
  cluster.sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id - b.id;
  });

  // ── Step 5 (Scenario 3): Insert new secondary if there is new info ───────
  const clusterEmails = new Set(cluster.map((c) => c.email).filter(Boolean));
  const clusterPhones = new Set(
    cluster.map((c) => c.phoneNumber).filter(Boolean)
  );

  const emailIsNew = email && !clusterEmails.has(email);
  const phoneIsNew = phoneNumber && !clusterPhones.has(phoneNumber);

  if (emailIsNew || phoneIsNew) {
    const newSecondary = await insertContact(
      email,
      phoneNumber,
      truePrimary.id,
      "secondary"
    );
    cluster.push(newSecondary);
  }

  // ── Step 6: Format & return ────────────────────────────────────────────────
  return formatResponse(cluster);
}

// ── response builder ─────────────────────────────────────────────────────────

function formatResponse(cluster: Contact[]): IdentifyResponse {
  // Sort: primary first, then by createdAt
  cluster.sort((a, b) => {
    if (a.linkPrecedence === "primary" && b.linkPrecedence !== "primary") return -1;
    if (a.linkPrecedence !== "primary" && b.linkPrecedence === "primary") return 1;
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id - b.id;
  });

  const primary = cluster.find((c) => c.linkPrecedence === "primary")!;

  // Collect unique emails (primary's first)
  const emails: string[] = [];
  if (primary.email) emails.push(primary.email);
  for (const c of cluster) {
    if (c.email && !emails.includes(c.email)) {
      emails.push(c.email);
    }
  }

  // Collect unique phone numbers (primary's first)
  const phoneNumbers: string[] = [];
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);
  for (const c of cluster) {
    if (c.phoneNumber && !phoneNumbers.includes(c.phoneNumber)) {
      phoneNumbers.push(c.phoneNumber);
    }
  }

  // Secondary IDs
  const secondaryContactIds = cluster
    .filter((c) => c.linkPrecedence === "secondary")
    .map((c) => c.id);

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds,
    },
  };
}
