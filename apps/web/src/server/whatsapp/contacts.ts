import { createHmac, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAddress, isAddress, zeroAddress } from "viem";
import { seal, unseal } from "./config";
import { actionFor, text } from "./menu";

type Contact = { id: string; account_id: string; payload: string; version: string };
type Details = { name: string; address: string };
type Draft = {
  id?: string;
  version?: string;
  name?: string;
  address?: string;
  stage: string;
  token: string;
};
const canonical = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ");
const nameKey = (name: string, key: Buffer) =>
  createHmac("sha256", key)
    .update("steward:contact:" + canonical(name).toLowerCase())
    .digest("hex");
export function migrateContacts(db: DatabaseSync) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS wa_contacts(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,name_key TEXT NOT NULL,payload TEXT NOT NULL,version TEXT NOT NULL,UNIQUE(account_id,name_key));
 CREATE TABLE IF NOT EXISTS wa_contact_sessions(account_id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS wa_payment_recipient_labels(account_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS wa_payment_contact_labels(payment_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
`);
}
export function contactById(db: DatabaseSync, key: Buffer, account: string, id: string) {
  const row = db
    .prepare("SELECT * FROM wa_contacts WHERE account_id=? AND id=?")
    .get(account, id) as Contact | undefined;
  return row ? { ...unseal<Details>(row.payload, key), id: row.id, version: row.version } : null;
}
export function contactByName(db: DatabaseSync, key: Buffer, account: string, name: string) {
  const row = db
    .prepare("SELECT id FROM wa_contacts WHERE account_id=? AND name_key=?")
    .get(account, nameKey(name, key)) as { id: string } | undefined;
  return row ? contactById(db, key, account, row.id) : null;
}
export function paymentContactLabel(db: DatabaseSync, key: Buffer, id: string) {
  const row = db
    .prepare("SELECT payload FROM wa_payment_contact_labels WHERE payment_id=?")
    .get(id) as { payload: string } | undefined;
  return row ? unseal<{ name: string }>(row.payload, key).name : null;
}
export function contactList(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  mode: "manage" | "send",
  page = 0,
) {
  const rows = db
    .prepare("SELECT * FROM wa_contacts WHERE account_id=? ORDER BY rowid LIMIT 101")
    .all(account) as Contact[];
  const last = Math.max(0, Math.ceil(rows.length / 7) - 1);
  page = Math.min(Math.max(0, page), last);
  const items: { id: string; title: string; description?: string }[] = rows
    .slice(page * 7, page * 7 + 7)
    .map((row) => {
      const c = unseal<Details>(row.payload, key);
      return {
        id: `${mode === "send" ? "paycontact" : "contact"}:pick:${row.id}`,
        title: c.name,
        description: c.address,
      };
    });
  if (mode === "manage") items.unshift({ id: "contact:add", title: "Add contact" });
  if (page > 0)
    items.push({
      id: `${mode === "send" ? "paycontact" : "contact"}:page:${page - 1}`,
      title: "Previous page",
    });
  if (page < last)
    items.push({
      id: `${mode === "send" ? "paycontact" : "contact"}:page:${page + 1}`,
      title: "Next page",
    });
  if (!items.length)
    return text(
      "You have no saved contacts yet. Type Manage contacts to add one, or enter a wallet address.",
    );
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text:
          mode === "send"
            ? "Choose a saved recipient. You’ll review their full address before confirming payment."
            : "Your saved contacts\nChoose a contact to view, edit or delete it.",
      },
      action: {
        button: mode === "send" ? "Choose contact" : "Your contacts",
        sections: [{ title: "Contacts", rows: items }],
      },
    },
  };
}
function buttons(body: string, rows: { id: string; title: string }[]) {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: rows.map((reply) => ({ type: "reply", reply })) },
    },
  };
}
// Called in the inbox transaction. All contact operations are scoped to its verified account.
export function contactsReply(db: DatabaseSync, key: Buffer, account: string, input: string) {
  const command = input.trim(),
    lower = command.toLowerCase().replace(/^\//, "");
  const paymentSession = db
    .prepare("SELECT account_id FROM wa_payment_sessions WHERE account_id=?")
    .get(account);
  const manage =
    (actionFor(lower) === "contacts" && !(paymentSession && /^\d+$/.test(lower))) ||
    lower === "contacts";
  const saved = db
    .prepare("SELECT payload,expires FROM wa_contact_sessions WHERE account_id=?")
    .get(account) as { payload: string; expires: number } | undefined;
  let draft = saved && saved.expires > Date.now() ? unseal<Draft>(saved.payload, key) : null;
  const clear = () => db.prepare("DELETE FROM wa_contact_sessions WHERE account_id=?").run(account);
  const save = (d: Draft) =>
    db
      .prepare(
        "INSERT INTO wa_contact_sessions(account_id,payload,expires) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload,expires=excluded.expires",
      )
      .run(account, seal(d, key), Date.now() + 600000);
  if (lower === "menu" || lower === "cancel") {
    clear();
    return draft && lower === "cancel" ? text("Contact changes cancelled.") : null;
  }
  if (manage || command.startsWith("contact:")) {
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account);
    db.prepare("DELETE FROM wa_payment_recipient_labels WHERE account_id=?").run(account);
  }
  if (manage || command.startsWith("contact:page:")) {
    clear();
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account);
    return contactList(
      db,
      key,
      account,
      "manage",
      /^contact:page:\d{1,3}$/.test(command) ? Number(command.split(":")[2]) : 0,
    );
  }
  if (command === "contact:add") {
    const n = db.prepare("SELECT count(*) n FROM wa_contacts WHERE account_id=?").get(account) as {
      n: number;
    };
    if (n.n >= 100)
      return text("You have reached 100 saved contacts. Delete a contact before adding another.");
    save({ stage: "name", token: randomUUID() });
    return text(
      "What is the contact’s name? Use up to 24 letters, numbers, spaces, dots or hyphens. Type Cancel to stop.",
    );
  }
  const pick = /^contact:(pick|edit|delete):([a-f0-9-]{36})$/.exec(command);
  if (pick) {
    const c = contactById(db, key, account, pick[2]);
    if (!c) return text("This contact no longer exists. Type Manage contacts to refresh.");
    if (pick[1] === "pick") {
      clear();
      return buttons(`${c.name}\n${c.address}\nVerify the recipient address on BNB Chain`, [
        { id: "contact:edit:" + c.id, title: "Edit contact" },
        { id: "contact:delete:" + c.id, title: "Delete contact" },
        { id: "contact:page:0", title: "Back to contacts" },
      ]);
    }
    draft = {
      id: c.id,
      version: c.version,
      name: c.name,
      address: c.address,
      stage: pick[1] === "edit" ? "name" : "delete",
      token: randomUUID(),
    };
    save(draft);
    if (pick[1] === "edit")
      return text(
        `Editing ${c.name}.\nEnter the contact name (or send the same name to keep it). Type Cancel to stop.`,
      );
    return buttons(`Delete ${c.name}?\n${c.address}\n\nThis removes the saved contact only.`, [
      { id: "contact:confirm:" + draft.token, title: "Delete contact" },
      { id: "contact:cancel:" + draft.token, title: "Cancel" },
    ]);
  }
  const confirm = /^contact:(confirm|cancel):([a-f0-9-]{36})$/.exec(command);
  if (confirm) {
    if (!draft || draft.token !== confirm[2] || !["review", "delete"].includes(draft.stage))
      return text(
        "This contact confirmation expired or was already used. Type Manage contacts to start again.",
      );
    if (confirm[1] === "cancel") {
      clear();
      return text("Contact changes cancelled.");
    }
    if (draft.id) {
      const c = contactById(db, key, account, draft.id);
      if (!c || c.version !== draft.version) {
        clear();
        return text("This contact changed. Open Manage contacts and review the latest details.");
      }
    }
    if (draft.stage === "delete") {
      db.prepare("DELETE FROM wa_contacts WHERE account_id=? AND id=? AND version=?").run(
        account,
        draft.id!,
        draft.version!,
      );
      clear();
      return text("Contact deleted. Type Manage contacts to return.");
    }
    const duplicate = contactByName(db, key, account, draft.name!);
    if (duplicate && duplicate.id !== draft.id) {
      clear();
      return text(
        "You already have a contact with that name. Choose another name or edit the existing contact.",
      );
    }
    const details = { name: draft.name!, address: draft.address! };
    if (draft.id)
      db.prepare(
        "UPDATE wa_contacts SET name_key=?,payload=?,version=? WHERE account_id=? AND id=? AND version=?",
      ).run(
        nameKey(details.name, key),
        seal(details, key),
        randomUUID(),
        account,
        draft.id,
        draft.version!,
      );
    else
      db.prepare(
        "INSERT INTO wa_contacts(id,account_id,name_key,payload,version) VALUES(?,?,?,?,?)",
      ).run(randomUUID(), account, nameKey(details.name, key), seal(details, key), randomUUID());
    clear();
    return text(
      `${details.name} saved.\n${details.address}\n\nChoose Send payment to use this contact.`,
    );
  }
  if (command.startsWith("contact:"))
    return text("This contact action is no longer valid. Type Manage contacts to refresh.");
  if (!draft) return null;
  if (
    actionFor(lower) ||
    ["send", "my account", "account", "balance"].includes(lower) ||
    command.startsWith("pay:") ||
    command.startsWith("paycontact:")
  ) {
    clear();
    return null;
  }
  if (draft.stage === "name") {
    const name = canonical(command);
    if (name.length > 24 || !/[\p{L}]/u.test(name) || !/^[\p{L}\p{N} .'-]+$/u.test(name))
      return text(
        "Use a name of up to 24 characters, including at least one letter. Letters, numbers, spaces, dots, apostrophes and hyphens are allowed.",
      );
    const duplicate = contactByName(db, key, account, name);
    if (duplicate && duplicate.id !== draft.id)
      return text("That name is already saved. Enter a different name.");
    draft.name = name;
    draft.stage = "address";
    save(draft);
    return text(
      `Enter ${name}’s 0x wallet address for BNB Chain.${draft.address ? "\nCurrent address: " + draft.address + "\nSend Keep to use the current address." : ""}`,
    );
  }
  if (draft.stage === "address") {
    const value = lower === "keep" && draft.address ? draft.address : command;
    if (!isAddress(value)) return text("Enter a valid 0x wallet address.");
    const address = getAddress(value);
    if (
      address === zeroAddress ||
      address.toLowerCase() === "0x13800afeea6f8688547770052b395099758d9a5b"
    )
      return text("Use the recipient’s wallet address, not the zero address or token contract.");
    draft.address = address;
    draft.stage = "review";
    save(draft);
    return buttons(
      `Save contact?\n\n${draft.name}\n${address}\n\nVerify the recipient address on BNB Chain`,
      [
        { id: "contact:confirm:" + draft.token, title: "Save contact" },
        { id: "contact:cancel:" + draft.token, title: "Cancel" },
      ],
    );
  }
  return text("Use the Save/Delete or Cancel buttons above, or type Cancel to stop.");
}
