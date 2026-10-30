import { Wrap } from "./primitives";

const FAQ_ITEMS = [
  {
    q: "What is KB OneMail exactly?",
    a: "A client for the Gmail accounts you already have, built on the Gmail API. Nothing migrates, your mail stays in Google. It started as a Gmail client and is expanding into a workspace: email, pull requests, and issues in one tab. GitHub is connected now. Linear is next.",
  },
  {
    q: "Self-host or hosted: what's the difference?",
    a: "Two ways to run the same client. Self-host is free and open source: bring your own OAuth credentials and run it on your own infra. Hosted is $5/mo and coming soon. Join the waitlist to be first in.",
  },
  {
    q: "Is it really open source?",
    a: "Yes. The full client is on GitHub: audit every line, self-host it for free, or fork it. Hosted runs the same code, maintained by us.",
  },
  {
    q: "Why does Google show a security warning when I sign in?",
    a: "Google has not yet approved this deployment's OAuth application. KB OneMail requests restricted Gmail permissions for its mail features. Public verification requires Google's review and, because mail passes through a server, a security assessment. Hosting the app for free does not remove these requirements. Review the privacy policy and wait for verification if you do not want to authorize an unverified app.",
  },
  {
    q: "Does KB OneMail store my mail?",
    a: "Messages are fetched live through the server and kept in memory, without a local mailbox database. Authentication records, encrypted OAuth tokens, account metadata, and snippets and signatures you create are stored. Gmail holds saved drafts. Windows notifications can retain sender and subject; Desktop settings offer private alerts and notifications-off. The privacy policy explains retention and your controls.",
  },
  {
    q: "When does hosted launch?",
    a: "Soon. Join the waitlist and you'll be the first to know. Self-host works today, straight from the repo.",
  },
];

export function Faq() {
  return (
    <Wrap label="faq">
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="-m-px grid grid-cols-1 md:grid-cols-2">
          {FAQ_ITEMS.map((it) => (
            <div key={it.q} className="border-t border-l border-border p-6">
              <h4 className="mb-2 text-[15px] font-medium tracking-tight text-foreground">
                {it.q}
              </h4>
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                {it.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Wrap>
  );
}
