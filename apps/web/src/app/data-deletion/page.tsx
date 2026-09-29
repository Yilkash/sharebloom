import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Data deletion | Sharebloom",
  description: "Request deletion of your Sharebloom account and personal information by email.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage title="Request data deletion">
      <p>
        You can request deletion of your Sharebloom account or specific personal information by
        contacting the Sharebloom operator. Requests are handled manually by email.
      </p>
      <h2>How to request deletion</h2>
      <ol>
        <li>
          Email{" "}
          <a href="mailto:stewardchat@gmail.com?subject=Sharebloom%20data%20deletion%20request">
            stewardchat@gmail.com
          </a>{" "}
          with the subject <strong>Sharebloom data deletion request</strong>.
        </li>
        <li>
          Include the WhatsApp number you used with Sharebloom, with its country code. For a
          web-only account, include your public wallet address instead. Tell us whether you want to
          delete the whole account or particular information.
        </li>
        <li>
          We may ask you to demonstrate control of the associated account. Never email private keys,
          recovery phrases, passwords, access tokens, or verification codes.
        </li>
        <li>
          We will review your request, explain any wallet or retention issues, and reply when it has
          been completed or explain what remains and why.
        </li>
      </ol>
      <h2>Wallets and remaining funds</h2>
      <p>
        Account deletion can affect access to your Sharebloom-managed wallet. Tell us if it still
        holds funds or has pending transactions so these can be addressed before account access is
        removed. A deletion request does not authorize a payment or a trade.
      </p>
      <h2>What the request covers</h2>
      <p>
        You may request deletion of stored messages and replies, contacts, chat context,
        phone/account associations, and other personal information held by Sharebloom. We will
        identify any records that need to be retained for unresolved transactions, security,
        disputes, or legal obligations and explain the reason. Backup copies may require separate
        handling; we will explain any remaining retention when responding.
      </p>
      <p>
        Confirmed blockchain transactions and public wallet history cannot be erased. Deleting
        Sharebloom data does not automatically delete your WhatsApp account or records held
        independently by Meta, wallet providers, AI providers, or other services. We will explain
        when a separate provider request is needed.
      </p>
      <h2>Clearing chat memory</h2>
      <p>
        Typing Menu in WhatsApp ends the active AI conversation and clears its short-term memory. It
        is not a request to delete your entire account or stored message records. Use the email
        process above for those requests.
      </p>
      <p>
        Read our <a href="/privacy">privacy policy</a> for more about data handling.
      </p>
    </LegalPage>
  );
}
