# Google sign-in

Students and staff sign in with Google. Nobody has a password. The local demo also has a one-click sign-in.

## How it works

- `/login` → **Sign in with Google** → `/api/auth/google?as=student`. On `/admin/login` the button uses `as=staff`.
- Before sending the browser to Google, the server makes a random `state`, a `nonce` and a PKCE verifier. It keeps
  them in a 10-minute httpOnly cookie.
- Google sends the browser back to `/api/auth/google/callback` with a one-time code. The server checks the `state`.
  It then exchanges the code with Google's token endpoint, using the client secret and the PKCE verifier, and checks
  the ID token:
  - the issuer is Google
  - the audience is this client
  - the token hasn't expired
  - the nonce matches
  - `email_verified` is true
  - when `GOOGLE_HOSTED_DOMAIN` is set, `hd` matches it
- Linking accounts:
  - **First sign-in:** the Google account is linked to the student whose email matches. Staff are matched against
    the staff list, active accounts only. The link is stored in `google_identities`, which is append-only.
  - **Later sign-ins:** the link decides, not the email. A different Google account with the same email can't take
    over a record.
- The browser never names the account. Students also need an email domain that `STUDENT_EMAIL_DOMAINS` allows.
- Code: `src/lib/auth/google.ts` and `src/app/api/auth/google/`. Tests: `tests/stage8.test.mjs`, which uses a local
  stand-in for Google's token endpoint.

## Setting it up (Google Cloud Console)

1. Go to https://console.cloud.google.com and create a project, or pick an existing one.
2. Open **APIs & Services → OAuth consent screen**. For a demo, choose **External** and add your own Google account
   under **Test users**. BTU would choose **Internal**, for its Workspace.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
4. Under **Authorised redirect URIs**, add the address of the portal followed by `/api/auth/google/callback`.
   For a local test copy on port 3100, that is `http://localhost:3100/api/auth/google/callback`.
5. In the portal folder, run `npm run google:setup` and answer its questions:
   - the **client ID** and **client secret** from step 3 (the secret isn't shown while you type, and is never printed);
   - **your Google address**, e.g. `you@gmail.com`. Students with that address's domain may then sign in;
   - **which demo student** opens when you sign in with Google. That student's email becomes your Google address.
     Enter picks the first one, `none` skips it;
   - whether your address should also be a **demo staff member** (OPERATOR) for `/admin/login`. Only asked when the
     address isn't a student's, because one address can't be both. Run the script again with another address for that.

   It saves everything in `data-demo/google.env`, readable only by you. That folder is ignored by git. On a server,
   use its secret settings instead. Never commit them. Running it again keeps the stored client when you press Enter.
   For another data folder, set it first: `DATA_DIR=data-testnet npm run google:setup`. A folder that follows a
   Google Sheet keeps the sheet's addresses: add a row with your Google address to the sheet, or use **Add student**
   in the admin area, and answer `none`.

   The file looks like this, if you'd rather write it by hand:

```
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
# The demo students use example.org addresses. Allow your own Google address too:
STUDENT_EMAIL_DOMAINS=example.org,gmail.com
# For BTU: only its Google Workspace
# GOOGLE_HOSTED_DOMAIN=btu.edu.ge
```

6. Restart with `PORT=3100 npm run quickstart` (or `DEMO_DIR=data-testnet npm run demo:start`; both read
   `google.env`). Open the portal at **localhost**, not 127.0.0.1, so that the address matches the redirect URI.
   **Sign in with Google** now appears on `/login` and `/admin/login`. Until then, the demo login page says that
   Google sign-in is off.

## The one-click demo sign-in

`PASSPORT_DEMO_LOGIN=1` adds a student list to `/login` and demo staff buttons to `/admin/login`. Only accounts
with `is_demo = 1` get a button. `quickstart` sets this variable and starts the app on 127.0.0.1, so no other
computer can reach it. Never set it on a server.

## Passwords

The password forms and their API routes are off. They return only with `PASSPORT_PASSWORD_LOGIN=1`, which the older
automated tests set. The setup scripts still write `dev-credentials.txt` for those tests. With the forms off, those
passwords can't be used to sign in.
