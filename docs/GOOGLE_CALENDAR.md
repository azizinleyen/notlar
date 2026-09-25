# Google Calendar write access

An iCal (`.ics`) link can read calendar events. To let Notlar add a follow-up meeting mentioned in a conversation to Google Calendar, a separate OAuth connection is required.

1. Create or select a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the [Google Calendar API](https://developers.google.com/workspace/calendar/api/quickstart/python#enable_the_api).
3. Configure the OAuth consent screen in Google Auth Platform. For personal use, if the app audience is **External** and the publishing status is **Testing**, add your own Google account as a test user.
4. Choose **Clients → Create client → Desktop app** and download the JSON file. See [Google's desktop client instructions](https://developers.google.com/workspace/calendar/api/quickstart/python#authorize_credentials_for_a_desktop_application).
5. Do not commit the JSON file. In Notlar, select it under **Settings (Ayarlar) → Google Calendar**, then connect your account.

Authorizations granted while the Google app is in **Testing** status may expire. For broader public use, review Google's [audience settings](https://support.google.com/cloud/answer/15549945) and [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

This flow is present in the installed version but has not yet been ported to the older `src/` sources. See [source status](SOURCE_STATUS.md).
