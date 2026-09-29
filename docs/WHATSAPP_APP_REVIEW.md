# Meta App Review — WhatsApp (DigiMithra)

Permissions to request: `whatsapp_business_messaging`, `whatsapp_business_management`.
Do NOT request any Instagram permission: the app has no Instagram integration.

## Description to paste (both permissions)

DigiMithra is a web app that local businesses use to manage their own Google Business Profile, leads and customer communication. A business owner connects their own WhatsApp Business number (Cloud API) and uses it for three things:

1. Receive enquiries: when a customer messages the business number, our webhook receives the message, stores it in the message log, and creates a lead in the owner's Lead CRM so the owner can follow up.
2. Reply and follow up: the owner opens the WhatsApp page or a lead and sends a text reply to that customer. Messages are only sent when the owner clicks Send, or through an automation rule the owner created and switched on (for example a thank-you to a new lead, or an alert to the owner's own number when a low-star review arrives).
3. Message log: every inbound and outbound message and its delivery status is shown to the owner so nothing is hidden.

We only message people who contacted the business or leads the owner entered, we do not send bulk or promotional broadcasts, and we do not sell or share message data. Free-form text is sent only inside the 24-hour customer-service window. Webhook events are verified with the app secret signature. Access tokens are stored on our server and never in the browser. Privacy Policy: https://gold-fitness-local-ranker.vercel.app/privacy

## Screencast script (about 2–3 minutes, English narration or captions)

Record with the real, live app and a test number you control. Show every step; reviewers reject cut-together or mocked flows.
1. Open https://gold-fitness-local-ranker.vercel.app and sign in. Show the WhatsApp page with status "Connected".
2. On a phone, send a WhatsApp message to the business number ("Hi, I want to join"). Show it on the phone.
3. In the app, refresh WhatsApp: show the inbound message in the log. Open Lead CRM: show the new lead created from that message.
4. Open the lead, type a reply, click Send. Show the message arriving on the phone.
5. Open Automations: show the "WhatsApp a thank-you to new leads" rule, switch it on, create a test lead, show the automatic message arriving and the log entry.
6. Show the WhatsApp status and state that access can be disconnected and data deleted (open /data-deletion).

## Before submitting
- App must be in Live mode, with the privacy policy URL, terms URL and data deletion URL saved in App settings.
- Vercel Deployment Protection must be off, or reviewers cannot open the app.
- Business verification with Meta is required for production messaging beyond test recipients.
- Provide a working test login (email and password) in the reviewer notes; use an account with no real customer data.
- Only tick "I agree to comply" if you will: no spam, no bulk marketing to people who did not opt in.
