import { createFileRoute, Link } from "@tanstack/react-router";
import { usePublicDesktopLifecycle } from "@/hooks/use-public-desktop";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy — KB OneMail" }] }),
  component: Privacy,
});

function Privacy() {
  usePublicDesktopLifecycle();
  return (
    <main className="min-h-svh bg-background px-6 py-14 text-foreground">
      <article className="mx-auto max-w-180 space-y-6 text-sm leading-relaxed">
        <Link to="/" className="font-mono text-primary">
          KB OneMail
        </Link>
        <h1 className="text-3xl font-semibold">
          Privacy for this private instance
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          Updated October 30, 2026
        </p>
        <p>
          This KB OneMail fork is operated by the owner of the deployment you
          are visiting. Contact that owner for access, deletion, retention and
          privacy questions. The original BetterBox developer does not operate
          this instance.
        </p>
        <h2 className="text-lg font-semibold">What is stored</h2>
        <p>
          Cloudflare D1 stores your basic user profile, sessions, linked
          provider identifiers, permitted account metadata, encrypted OAuth
          access and refresh tokens, and your user-created snippets and
          signatures. Google ID tokens are discarded after authorization.
          Snippets and signatures can contain personal information; create and
          delete them deliberately.
        </p>
        <h2 className="text-lg font-semibold">Your Gmail messages</h2>
        <p>
          Messages, senders, subjects, bodies, mailbox search results and
          attachments are fetched live from Google. They pass through this
          instance's Cloudflare Worker and are held in browser memory to display
          the interface. KB OneMail does not write them to D1, a mailbox index,
          browser storage or a service-worker cache. Private API responses use
          no-store headers. Gmail drafts are saved to Google.
        </p>
        <p>
          Closing a tab can lose edits that have not successfully saved to
          Gmail. Downloaded attachments and exports are files you choose to save
          on your device. Your browser and operating system control those files.
        </p>
        <h2 className="text-lg font-semibold">Windows desktop notifications</h2>
        <p>
          The Windows desktop app checks for new mail in the background while it
          is running. Notifications and sender/subject previews are enabled by
          default. Windows may retain the sender and subject in its notification
          history and show them on the lock screen. This operating-system
          notification history is an explicit exception to the app's
          no-mailbox-storage policy; KB OneMail does not maintain a local
          mailbox database.
        </p>
        <p>
          In Settings → Desktop, turn off Sender and subject previews for
          private notifications, or turn off Notifications entirely. Changing
          these options does not erase notifications Windows has already
          received; clear those in Windows Notification Center and use Windows
          notification settings to control lock-screen visibility. Launch at
          sign-in is off by default and can be enabled separately.
        </p>
        <h2 className="text-lg font-semibold">
          Permissions and other services
        </h2>
        <p>
          Google sign-in requests basic identity and gmail.modify to read,
          search, send, draft and organize mail. It does not permit immediate
          permanent deletion. Importing a native Gmail signature requests
          gmail.settings.basic only when you choose that feature. Optional
          GitHub access is separate.
        </p>
        <p>
          Cloudflare processes requests and stores the authentication database.
          Google processes Gmail operations. Remote email images are blocked by
          default; displaying them uses only image hosts explicitly trusted by
          the deployment owner. Such hosts can observe image requests from
          Cloudflare. Basic profile images may load from Google's image service.
        </p>
        <p>
          This fork has no third-party analytics or paid billing integration.
          Operational errors log an operation and status, without mailbox
          contents or credentials. Cloudflare may retain infrastructure metadata
          according to its service terms and the owner's account settings.
        </p>
        <h2 className="text-lg font-semibold">Control and retention</h2>
        <p>
          Disconnecting removes a linked credential from this app; it does not
          delete mail in Google. Revoke grants at{" "}
          <a
            className="text-primary underline"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account permissions
          </a>
          . Contact the instance owner to delete your application user,
          sessions, snippets and signatures. Backups and D1 recovery history
          have their own retention periods.
        </p>
        <p>
          Theme, account colors, account selection and board layouts are
          preferences stored in your browser. Signing out clears in-memory
          application queries. No process can guarantee deletion of browser
          history, device backups or files you exported.
        </p>
        <h2 className="text-lg font-semibold">Google Limited Use</h2>
        <p>
          Google API data is used to provide the mail features you request,
          without sale, advertising, unrelated analysis or AI training. This
          deployment's use and transfer of Google data must follow the{" "}
          <a
            className="text-primary underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including Limited Use. Private use and avoiding mailbox storage do
          not establish an exemption from Google's OAuth verification rules.
        </p>
      </article>
    </main>
  );
}
