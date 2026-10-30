/** Mailbox folders — each maps to a Gmail search query for messages.list.
 *  "labeled" is special: its pane groups messages by tag into accordions
 *  rather than showing a flat list. */
export type Folder =
  | "inbox"
  | "unread"
  | "starred"
  | "labeled"
  | "sent"
  | "drafts"
  | "archived"
  | "spam"
  | "trash";

export const FOLDERS: Folder[] = [
  "inbox",
  "unread",
  "starred",
  "labeled",
  "sent",
  "drafts",
  "archived",
  "spam",
  "trash",
];

export const FOLDER_QUERY: Record<Folder, string> = {
  inbox: "in:inbox",
  unread: "is:unread -in:trash -in:spam",
  starred: "is:starred -in:trash -in:spam",
  // Any message carrying a user label (the accordion view groups these by tag).
  labeled: "has:userlabels",
  sent: "in:sent",
  drafts: "in:drafts",
  // Archived = received mail that's left the inbox but isn't spam/trash.
  archived: "-in:inbox -in:sent -in:draft -in:trash -in:spam",
  spam: "in:spam",
  trash: "in:trash",
};

export function isFolder(value: unknown): value is Folder {
  return typeof value === "string" && (FOLDERS as string[]).includes(value);
}

export function toFolder(value: unknown): Folder {
  return isFolder(value) ? value : "inbox";
}
