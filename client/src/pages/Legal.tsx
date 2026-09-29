import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const CONTACT = 'dhanusgoldfitness@gmail.com';
const UPDATED = '30 September 2026';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-800 dark:bg-ink-950 dark:text-slate-200">
      <header className="border-b border-slate-200 px-6 py-4 dark:border-ink-700"><Link to="/login" className="flex items-center gap-3"><img src="/favicon.png" alt="" className="h-9 w-9 rounded-lg" /><span className="text-lg font-extrabold">Digi<span className="italic text-gold-500">Mithra</span></span></Link></header>
      <main className="mx-auto max-w-3xl space-y-4 px-6 py-10 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-gold-500 [&_a]:underline">
        <h1 className="text-3xl font-extrabold">{title}</h1>
        <p className="text-xs text-slate-500">Last updated: {UPDATED}</p>
        {children}
      </main>
      <footer className="border-t border-slate-200 px-6 py-6 text-center text-xs text-slate-500 dark:border-ink-700">
        © {new Date().getFullYear()} DigiMithra · <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link> · <Link to="/data-deletion">Data Deletion</Link>
      </footer>
    </div>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p>DigiMithra ("we", "us") provides a web application that helps businesses manage their own Google Business Profile, track local search rankings, reply to reviews, manage leads and create marketing content. This policy explains what data we handle and why.</p>
      <h2>Information we collect</h2>
      <ul>
        <li><b>Account data:</b> your name, email address and phone number when you register.</li>
        <li><b>Google account data, only if you connect Google:</b> your Google email and name, and the Google Business Profile data you authorise — your locations, business details, reviews, review replies, posts and performance metrics. We request the <code>business.manage</code> scope and only use it for the features described here.</li>
        <li><b>Content you create:</b> keywords, competitor lists, leads and notes, invoices and customer records, AI-generated drafts, images and videos.</li>
        <li><b>WhatsApp messages, only if you connect WhatsApp:</b> messages you send or receive through the WhatsApp Business Platform for your own business, and the phone numbers involved.</li>
        <li><b>Technical data:</b> basic logs (such as timestamps and error messages) needed to keep the service secure and working.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To provide the features you ask for: sync and display your Business Profile, run audits, check rankings, draft review replies and posts, and send notifications.</li>
        <li>To keep the service secure, prevent abuse and fix problems.</li>
        <li>We do <b>not</b> sell your data, use it for advertising, or use it to train generative AI models.</li>
      </ul>
      <h2>Google user data (Limited Use)</h2>
      <p>DigiMithra's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. We use Google user data only to provide and improve the user-facing features you request. We do not transfer it to others except as needed to provide those features, to comply with law, or as part of a merger or sale with notice to you. We do not allow humans to read your Google data unless you ask for support, it is needed for security or abuse investigation, or the law requires it.</p>
      <h2>AI processing</h2>
      <p>When you use AI features, the relevant text (for example a review, or your business name, category and city) is sent to Google's Gemini API to generate a response. We send only what is needed for the request. AI output is a draft: replies to reviews are never published without your approval.</p>
      <h2>Where data is stored and how it is protected</h2>
      <p>Data is stored with our infrastructure providers (Supabase for database and file storage, Render and Vercel for hosting). Google refresh tokens are encrypted at rest and are never exposed to your browser. Access to your data is restricted to your account by row-level security and server-side checks. No method of storage is perfectly secure, but we work to protect your data.</p>
      <h2>Sharing</h2>
      <p>We share data only with the service providers needed to run the app (hosting, database, Google APIs, Gemini, and Meta/WhatsApp if you connect it), who process it on our behalf, and where required by law.</p>
      <h2>Retention and deletion</h2>
      <p>We keep your data while your account is active. You can disconnect Google at any time in the app (Google Business → Disconnect), which deletes the stored Google token immediately. You can ask us to delete your account and data — see <Link to="/data-deletion">Data Deletion</Link>. You can also revoke access at any time from your Google Account's third-party access settings.</p>
      <h2>Your rights</h2>
      <p>You can ask to access, correct, export or delete your personal data by contacting us.</p>
      <h2>Children</h2>
      <p>The service is for businesses and is not directed at children under 18.</p>
      <h2>Changes</h2>
      <p>We may update this policy and will change the date above when we do.</p>
      <h2>Contact</h2>
      <p>DigiMithra — <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of Service">
      <p>By creating an account or using DigiMithra you agree to these terms.</p>
      <h2>The service</h2>
      <p>DigiMithra is a tool for managing your own Google Business Profile and related marketing tasks. Some features depend on third-party services (Google, Meta/WhatsApp, Gemini) and their availability, approvals and policies; where a service is not connected the app shows its real status instead of sample data.</p>
      <h2>Your account and content</h2>
      <ul>
        <li>You must give accurate information and keep your login secure.</li>
        <li>You may connect only Google Business Profiles and WhatsApp numbers that you own or are authorised to manage.</li>
        <li>You are responsible for content you publish, including replies and posts you approve. AI drafts can be wrong; review them before publishing.</li>
        <li>You must follow the terms and policies of Google, Meta and any other connected service, and applicable law (including messaging and consent rules when contacting customers).</li>
      </ul>
      <h2>Acceptable use</h2>
      <p>Do not misuse the service: no unlawful, deceptive or abusive activity, no fake reviews, no spam, and no attempts to disrupt or gain unauthorised access to the service.</p>
      <h2>Plans and limits</h2>
      <p>Plans limit locations, keywords, scans and AI usage. We may change plans or limits with notice.</p>
      <h2>Availability and disclaimer</h2>
      <p>The service is provided "as is" without warranties. Ranking data, scores and AI output are informational and not a guarantee of search results or business outcomes. To the extent permitted by law, we are not liable for indirect or consequential losses.</p>
      <h2>Termination</h2>
      <p>You may stop using the service at any time. We may suspend accounts that breach these terms.</p>
      <h2>Contact</h2>
      <p><a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </Page>
  );
}

export function DataDeletion() {
  return (
    <Page title="Data Deletion">
      <p>You can remove your data from DigiMithra in two ways.</p>
      <h2>1. Disconnect Google or WhatsApp yourself</h2>
      <ul>
        <li>In the app open <b>Google Business → Disconnect</b>. This deletes your stored Google access token immediately.</li>
        <li>You can also revoke DigiMithra at any time in your Google Account under Security → Third-party access.</li>
      </ul>
      <h2>2. Delete your account and all data</h2>
      <p>Email <a href={`mailto:${CONTACT}?subject=Delete my DigiMithra data`}>{CONTACT}</a> from the address you registered with, with the subject "Delete my DigiMithra data". We will delete your account, connected-service tokens, reviews, leads, content and files, and confirm by email, within 30 days. Some records may be kept where the law requires (for example invoices).</p>
      <h2>WhatsApp / Meta users</h2>
      <p>If you contacted a business that uses DigiMithra over WhatsApp and want your messages deleted, email the same address with your phone number and we will remove the related records.</p>
    </Page>
  );
}
