# Dr Kulsoom Skin and Laser Clinic

Live site: https://drkulsoomclinic.com

A full patient facing website and clinic management system for a dermatology practice, connecting patients, staff, and the doctor on one platform built with vanilla HTML, CSS, and JavaScript, backed by Firebase.

---

## What This Is

Most clinic websites stop at "here is our phone number, please call us." This one does not. A patient can book a consultation, pay, chat with the doctor in real time including voice notes and shared photos, read the clinic blog, and leave a review, all without leaving the browser. On the other side, the doctor and staff run the entire operation, bookings, schedules, payments, and messaging, from dashboards built specifically for how a real dermatology clinic actually works day to day.

## Who It's For

Rather than one long feature list up front, here is what each type of user actually gets.

### Patients
- Browse services and pricing on the homepage
- Book an online consultation (account required) or a physical visit (guest checkout, no account needed)
- View each clinic location with an expandable map right on the page
- Track all bookings from a personal "My Bookings" page
- Chat with the doctor directly once a session window opens, including photos, documents, and voice notes
- Reach support chat for quick questions, with or without an account
- Read the clinic blog and like posts
- Leave a star rating and written review after a completed visit

### The Doctor
- One dashboard with sessions organized into upcoming, completed, cancelled, and no show tabs
- Unread indicator per patient so no message goes unseen
- Real time visibility into when a patient is online, typing, or recording a voice note
- Reply with text, photos, documents, or voice notes in the same thread
- Publish posts to the clinic blog

### Clinic Staff (Manager and Admin)
- Manager panel: bookings, branch hours, payment accounts, availability
- Admin panel: everything the manager has, plus services and pricing, staff accounts, and blog content
- Approve or decline booking requests, each with an automatic email to the patient
- Send in app notifications to a single patient, a single staff member, or everyone at once

## How It Works

    Patient books a consultation
              |
              v
      Booking saved to Firestore
              |
      +-------+--------+
      |                |
      v                v
   Staff reviews   Payment screenshot
   and confirms    compressed and uploaded
      |
      v
   Chat window opens automatically
   for that booking's time slot
      |
      v
   Patient and doctor message directly
   inside one continuous per patient thread,
   sharing text, photos, documents, and voice notes

## Every Feature, By Area

### Booking and Payments
- Online consultation booking for registered patients, physical visit booking as a guest
- Live payment account details shown at checkout, with screenshot upload for verification
- Automatic slot locking so two patients can never book the same time

### Messaging
- One continuous chat thread per patient rather than per visit, so history carries across appointments
- Voice notes with a custom waveform player instead of the browser's default audio controls
- Photo and document sharing, with photos opening in a lightbox for a closer look
- Real time presence, online, offline, typing, and recording indicators shown in the chat header
- A separate support chat channel for quick questions, open to guests as well as patients

### Media Handling
- Large phone camera photos are compressed in the browser before upload, so sending a payment screenshot or a photo in chat feels fast even on a slow connection
- Documents upload and share alongside images and voice notes in the same chat thread

### Location and Discovery
- Expandable map embed on each clinic location, with a link out to full directions
- Structured data, sitemap, and server rendered service listings for search engine visibility

### Content and Community
- Doctor and admin authored blog with a like button on every post
- Public reviews with star ratings, visible to anyone browsing the site

### Notifications and Reminders
- Automated email sent the moment a patient submits a booking request
- Automated email sent when staff confirms a booking, with different wording for online versus physical visits
- Automated email sent when a booking is declined, explaining the likely reason and pointing the patient to support chat
- Automated email sent when a booking is rescheduled, with the new date and time
- Best effort 15 minute reminder email before an online consultation starts
- Automatic email alert to the manager's inbox whenever a new booking request comes in, so nothing waits unnoticed
- Separate in app bell notification system, independent of email, showing unread counts and tied to the exact chat or booking that triggered each alert
- Opening the relevant chat or booking automatically clears only that notification, not the entire list

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (ES modules) |
| Authentication | Firebase Authentication |
| Database | Cloud Firestore |
| File storage | Cloudinary |
| Maps | Google Maps embed (no API key required) |
| Hosting | Firebase Hosting |
| Email | EmailJS |

## Project Structure

    dr-kulsoom-website/
        index.html                  Homepage
        booking.html                 Online and physical booking flows
        my-bookings.html              Patient booking history and chat
        blog.html / blog-post.html    Clinic blog
        reviews.html                  Public reviews
        manager.html / admin.html     Staff dashboards
        doctor.html                    Doctor dashboard
        firebase-config.js             Firebase app initialization
        chat-ui.js                      Shared chat rendering, voice notes, media
        presence.js                     Online, typing, and recording status
        image-compress.js               Client side photo compression
        location-map.js                 Map embed toggle
        blog-lightbox.js / blog-likes.js  Blog photo viewer and like button
        notifications.js                In app notification bell
        styles.css                      Site wide styling
        firebase.json / .firebaserc     Firebase Hosting configuration
        README.md

## Running Locally

This project depends on a connected Firebase project for Firestore and Authentication to function. To preview the static frontend on its own:

    git clone https://github.com/121-Hina/dr-kulsoom-website.git
    cd dr-kulsoom-website
    python -m http.server 8000

Then open `http://localhost:8000`. Live data features will only work when pointed at a configured Firebase project with matching Firestore rules.

## Deployment

The live site deploys through the Firebase CLI.

    firebase deploy --only hosting

## Roadmap
- True scheduled reminder emails once a paid Firebase plan is in place
- Individual indexed URLs for each blog post rather than one shared listing page
- Searching and browsing older chat history beyond what is currently visible in a conversation

## Acknowledgments

Built and maintained as a pro bono project for Dr Kulsoom Skin and Laser Clinic.
