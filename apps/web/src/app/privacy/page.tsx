import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy | Sharebloom",
  description:
    "How Sharebloom handles WhatsApp messages, wallet information, and privacy requests.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Sharebloom (we, us), operated by Steward Pay, provides a WhatsApp assistant and a web
        application for wallet balances, contacts, payments, and stock-token activity. This notice
        explains how we handle information when you use these services. Contact the Sharebloom
        operator at <a href="mailto:stewardchat@gmail.com">stewardchat@gmail.com</a> for privacy
        questions.
      </p>
      <h2>Information we process</h2>
      <ul>
        <li>
          <strong>WhatsApp information:</strong> your phone number or WhatsApp identifier, messages
          you send, button selections, message identifiers, timestamps, and our replies.
        </li>
        <li>
          <strong>Account and wallet information:</strong> account identifiers, consent choices,
          wallet addresses, wallet-provider identifiers, balances, and wallet setup status.
        </li>
        <li>
          <strong>Payments, trades, and contacts:</strong> recipient details and contact names you
          provide, amounts, tokens, quotes, confirmations, transaction hashes, and outcomes.
        </li>
        <li>
          <strong>Website and support information:</strong> wallet sign-in information, necessary
          session cookies, requests to our website, error information, and emails you send us.
          Hosting and other providers may also process technical information such as IP addresses.
        </li>
      </ul>
      <h2>How we use information</h2>
      <p>
        We use this information to reply to you, maintain your account, create and operate your
        managed wallet, display balances and activity, save contacts, prepare transactions, carry
        out transactions you confirm, prevent duplicate processing and abuse, and provide support.
        We record consent and transaction decisions to maintain account and payment integrity.
      </p>
      <h2>AI chat and service providers</h2>
      <p>
        When you use Ask Sharebloom, your message, recent conversation context, and relevant task
        details are sent to OpenServ for AI processing. Information you include in a message,
        including personal or financial details, can therefore be included in that processing.
      </p>
      <ul>
        <li>
          <strong>Meta / WhatsApp</strong> delivers incoming messages and our replies.
        </li>
        <li>
          <strong>OpenServ and its inference providers</strong> process assistant requests.
        </li>
        <li>
          <strong>Privy</strong> provides managed-wallet creation and transaction signing.
        </li>
        <li>
          <strong>Railway</strong> hosts the application and its databases.
        </li>
        <li>
          <strong>KyberSwap and blockchain infrastructure providers</strong> process quote, balance,
          and transaction requests, including relevant wallet addresses and trade details.
        </li>
        <li>
          <strong>Google</strong> provides fonts used by the website and Gmail for support email.
        </li>
      </ul>
      <p>
        These providers process information under their own applicable terms and privacy practices.
        Processing may take place outside your country. Information may also be disclosed where
        required by law or necessary to address fraud, security incidents, or threats to users and
        the service.
      </p>
      <h2>Blockchain records and phone lookup</h2>
      <p>
        Blockchain transactions, wallet addresses, token movements, and related activity are public
        and can remain permanently accessible. Sharebloom cannot remove or alter confirmed
        blockchain records. If you enable phone-number recipient lookup in Help &amp; settings,
        other Sharebloom users who know your number can resolve it to your payment wallet. You can
        disable this setting again.
      </p>
      <h2>Storage and retention</h2>
      <p>
        Sharebloom stores operational data in application databases. Sensitive WhatsApp payloads are
        encrypted at rest, and phone identifiers are also used in keyed lookup form. Authorized
        service processes can decrypt data to operate the assistant; encryption does not make that
        data anonymous.
      </p>
      <p>
        Typing Menu ends the active AI chat and clears its short-term conversation memory. This does
        not erase stored incoming messages, replies, account records, transaction records, provider
        records, or backups. Some temporary records expire automatically; other operational records
        currently have no fixed automatic deletion period and remain until manually removed. Backup
        copies can outlast removal from the active database.
      </p>
      <h2>Your choices and deletion requests</h2>
      <p>
        You can stop messaging Sharebloom, end AI chat by typing Menu, manage saved contacts, and
        change phone lookup settings. You may request access to, correction of, or deletion of your
        information by emailing <a href="mailto:stewardchat@gmail.com">stewardchat@gmail.com</a>. We
        may ask you to confirm control of the associated WhatsApp account before acting.
      </p>
      <p>
        See <a href="/data-deletion">data deletion instructions</a> for the request process, wallet
        considerations, and limits on deleting public blockchain or independently held provider
        records. We will explain any information that must be retained and why.
      </p>
      <h2>Website cookies</h2>
      <p>
        The web application uses necessary cookies for wallet sign-in challenges and sessions. The
        privacy and deletion pages can be read without connecting a wallet or signing in. Your
        browser also contacts Google to load the website fonts.
      </p>
      <h2>Changes to this notice</h2>
      <p>
        We will update this page when our data practices change and revise the date above. Contact
        us if you have questions about how a change affects your information.
      </p>
    </LegalPage>
  );
}
