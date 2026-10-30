import { parseAddress, splitAddresses } from "@/components/mail/email-html";

type ReplyMessage = {
  from: string;
  to?: string;
  cc?: string;
  replyTo?: string;
  labelIds?: string[];
};
export function replyTarget<T extends ReplyMessage>(
  messages: T[],
  self: string,
): T | undefined {
  const sent = messages.filter(
    (message) => !message.labelIds?.includes("DRAFT"),
  );
  return (
    [...sent]
      .reverse()
      .find(
        (message) =>
          parseAddress(message.from).address.trim().toLowerCase() !==
          self.trim().toLowerCase(),
      ) ?? sent.at(-1)
  );
}
export function replyRecipients(
  message: ReplyMessage,
  self: string,
  all = false,
): { to: string[]; cc: string[] } {
  const own =
    parseAddress(message.from).address.trim().toLowerCase() ===
    self.trim().toLowerCase();
  const seen = new Set([self.trim().toLowerCase()]);
  const dedupe = (addresses: string[]) =>
    addresses
      .map((address) => address.trim())
      .filter((address) => {
        const key = address.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  const target = splitAddresses(message.replyTo || message.from);
  return {
    to: dedupe(
      own
        ? splitAddresses(message.to ?? "")
        : [...target, ...(all ? splitAddresses(message.to ?? "") : [])],
    ),
    cc: all ? dedupe(splitAddresses(message.cc ?? "")) : [],
  };
}
