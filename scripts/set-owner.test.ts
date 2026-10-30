import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { grantOwner } from "./set-owner";

test("owner grants reject absent and case-ambiguous identities before changing roles", async () => {
  const db = new Database(":memory:");
  try {
    db.run(
      'CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, role TEXT, updatedAt INTEGER)',
    );
    db.run(
      "INSERT INTO user VALUES ('one','Owner@example.test','USER',0),('two','owner@example.test','USER',0)",
    );
    const execute = async <T>(sql: string): Promise<T[]> =>
      db.query(sql).all() as T[];
    await expect(grantOwner("owner@example.test", execute)).rejects.toThrow(
      "unique",
    );
    await expect(grantOwner("absent@example.test", execute)).rejects.toThrow(
      "unique",
    );
    expect(db.query("SELECT role FROM user").all()).toEqual([
      { role: "USER" },
      { role: "USER" },
    ]);
    db.run("DELETE FROM user WHERE id='two'");
    await grantOwner("owner@example.test", execute);
    expect(db.query("SELECT role FROM user WHERE id='one'").get()).toEqual({
      role: "OWNER",
    });
  } finally {
    db.close();
  }
});
