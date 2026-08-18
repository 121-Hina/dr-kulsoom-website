// email-notify.js — shared EmailJS wiring for booking status + reminder emails.
// Uses the classic EmailJS SDK, loaded via a <script> tag on each page that
// needs it (window.emailjs), since EmailJS's browser package is friendliest
// that way.

const PUBLIC_KEY = "tBaz910N94LK_CnmA";
const SERVICE_ID = "service_bwz37a5";
// IMPORTANT: these two map to specific EmailJS templates by their exact
// field schema, not by name — mixing them up silently breaks every email
// (EmailJS returns a 422 because the recipient placeholder in the template
// doesn't match the params we send).
//  - "Request" (template_a1drlhn): fixed wording, expects
//    to_email / to_name / mode / date / time — used only for the very
//    first "booking submitted" email.
//  - "Auto-Reply" (template_gz03axi): generic wrapper, expects
//    email / to_name / email_subject / email_body — reused for confirmed,
//    declined, rescheduled, reminder, and the manager alert email.
const TEMPLATE_SUBMITTED = "template_a1drlhn";
const TEMPLATE_GENERIC = "template_gz03axi";

// Where "new booking request" alerts go — the manager's inbox.
const MANAGER_ALERT_EMAIL = "biladulhaq04@gmail.com";

let initialized = false;
function ensureInit() {
  if (!initialized && window.emailjs) {
    window.emailjs.init(PUBLIC_KEY);
    initialized = true;
  }
}

function modeLabel(mode) {
  return mode === "online" ? "online consultation" : "physical visit";
}

export function sendBookingSubmittedEmail({ toEmail, toName, mode, date, time }) {
  if (!toEmail) return;
  ensureInit();
  if (!window.emailjs) return;
  window.emailjs.send(SERVICE_ID, TEMPLATE_SUBMITTED, {
    to_email: toEmail,
    to_name: toName || "there",
    mode: modeLabel(mode),
    date, time
  }).catch(() => {});
}

function sendGenericEmail({ toEmail, toName, subject, body }) {
  if (!toEmail) return;
  ensureInit();
  if (!window.emailjs) {
    console.error("[email-notify] EmailJS SDK not loaded, skipping email:", subject);
    return;
  }
  // NOTE: the "Auto-Reply" EmailJS template's "To Email" field is configured
  // as {{email}}, not {{to_email}} — the recipient key here must match that
  // exactly or the email silently has no recipient and never sends.
  window.emailjs.send(SERVICE_ID, TEMPLATE_GENERIC, {
    email: toEmail,
    to_name: toName || "there",
    email_subject: subject,
    email_body: body
  }).catch(err => {
    console.error("[email-notify] Failed to send email:", subject, err);
  });
}

export function sendBookingConfirmedEmail({ toEmail, toName, mode, date, time, location }) {
  const modeNote = mode === "online"
    ? "Please be ready and online with Dr. Kulsoom at your scheduled time — you can join the consultation chat from the \"My Bookings\" page on our website."
    : `Please visit us at ${location || "the clinic"} at your scheduled time.`;

  sendGenericEmail({
    toEmail, toName,
    subject: "Your booking is confirmed!",
    body: `Congratulations, your ${modeLabel(mode)} is confirmed for ${date} at ${time}!\n\n${modeNote}\n\nDr. Kulsoom gives every patient a full, unhurried 30 minutes, with plenty of time to ask questions and understand your treatment plan clearly before anything begins. If you need to reschedule or have any questions before your appointment, just reach out through our Support Chat on the website, we're happy to help.\n\nWe look forward to seeing you.`
  });
}

export function sendBookingDeclinedEmail({ toEmail, toName, mode, date, time }) {
  sendGenericEmail({
    toEmail, toName,
    subject: "About your booking request",
    body: `Unfortunately, your ${modeLabel(mode)} booking request for ${date} at ${time} could not be confirmed.\n\nThis usually happens for one of a few reasons: the payment screenshot wasn't clear or didn't match the account details, the payment wasn't received, or a technical issue came up while we were reviewing your request.\n\nPlease don't worry, message us on Support Chat on our website and our team will help sort this out and get you booked as soon as possible.\n\nWhile you're there, take a look at our full range of face, hair, and skin treatments and see what other patients are saying in our reviews.`
  });
}

export function sendConsultationReminderEmail({ toEmail, toName, date, time }) {
  sendGenericEmail({
    toEmail, toName,
    subject: "Your consultation starts in 15 minutes",
    body: `This is a friendly reminder that your online consultation with Dr. Kulsoom is starting in about 15 minutes, at ${time} on ${date}.\n\nPlease be ready and online at that time. You can join the consultation chat from the "My Bookings" page on our website.`
  });
}

export function sendBookingRescheduledEmail({ toEmail, toName, mode, date, time, location }) {
  const modeNote = mode === "online"
    ? "Please be ready and online with Dr. Kulsoom at your new scheduled time — you can join the consultation chat from the \"My Bookings\" page on our website."
    : `Please visit us at ${location || "the clinic"} at your new scheduled time.`;

  sendGenericEmail({
    toEmail, toName,
    subject: "Your session has been rescheduled",
    body: `Your ${modeLabel(mode)} has been rescheduled. Your new appointment is on ${date} at ${time}.\n\n${modeNote}\n\nIf this new time doesn't work for you, please reach out through our Support Chat on the website and we'll help you find another slot.\n\nIn the meantime, feel free to browse our blog for skincare tips from Dr. Kulsoom.`
  });
}

export function sendNewBookingRequestEmail({ patientName, mode, date, time }) {
  sendGenericEmail({
    toEmail: MANAGER_ALERT_EMAIL,
    toName: "there",
    subject: "New booking request received",
    body: `${patientName || "A patient"} has requested a ${modeLabel(mode)} on ${date} at ${time}.\n\nPlease review and confirm or decline it from the Bookings tab on the manager dashboard.`
  });
}
